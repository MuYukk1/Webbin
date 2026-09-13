// Worker 路由逻辑集成测试(stub KV,不跑真实 LLM)
// 与 wrangler.toml 的 Text 模块规则一致:*.user.js 按纯文本导入
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".user.js")) {
      const source = "export default " + JSON.stringify(readFileSync(fileURLToPath(url), "utf8"));
      return { source, format: "module", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// 静态 import 会在 registerHooks 之前求值,必须动态导入
const { default: mod } = await import("../index.js");

const KV = {
  store: new Map(),
  async get(k, t) { const v = this.store.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); },
  async put(k, v) { this.store.set(k, String(v)); },
  async delete(k) { this.store.delete(k); },
  async list({ prefix }) {
    return { keys: [...this.store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
  },
};
const env = { KV, TOKEN: "test-token" };

async function req(method, path, body, token) {
  const r = await mod.fetch(new Request("https://w.dev" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: r.status, data: await r.json() };
}

let pass = 0, fail = 0;
function t(name, cond) { cond ? pass++ : fail++; console.log(cond ? "  ✓" : "  ✗", name); }

t("无 token 返回 401", (await req("GET", "/api/items")).status === 401);
t("根路径健康检查", (await req("GET", "/")).data.ok === true);

const save = await req("POST", "/api/save", { url: "https://example.com/a", title: "测试网页", content: "正文内容", type: "web" }, "test-token");
t("保存返回 32 位 id", /^[a-f0-9]{32}$/.test(save.data.id));
t("保存返回完整条目(供客户端本地合并)", save.data.title === "测试网页" && save.data.status === "pending");

const list = await req("GET", "/api/items", null, "test-token");
t("列表含 1 条且不返回正文", list.data.items.length === 1 && list.data.items[0].has_content === true && !("content" in list.data.items[0]));

await req("POST", "/api/settings", { api_base: "https://invalid.invalid/v1", api_key: "sk-1234567890", model: "m1" }, "test-token");
let s = await req("GET", "/api/settings", null, "test-token");
t("key 掩码正确", s.data.api_key_masked === "sk-***7890");
t("完整 key 不出现在响应里", !JSON.stringify(s.data).includes("1234567890"));

await req("POST", "/api/settings", { api_key: "" }, "test-token");
s = await req("GET", "/api/settings", null, "test-token");
t("空 key 不覆盖已存配置", s.data.configured === true);

const id = save.data.id;
await req("POST", "/api/status", { id, status: "archived", summary: "PC生成的总结" }, "test-token");
const item = await req("GET", "/api/item/" + id, null, "test-token");
t("PC 回写归档状态", item.data.status === "archived");
t("PC 回写总结内容", item.data.summary === "PC生成的总结");

const biliSave = await req("POST", "/api/save", { url: "https://www.bilibili.com/video/BV1xx411c7mD", title: "B站视频", type: "bilibili" }, "test-token");
const sumNoContent = await req("POST", "/api/summarize", { id: biliSave.data.id }, "test-token");
t("无正文条目总结给出清晰提示", sumNoContent.status === 400 && sumNoContent.data.error.includes("正文"));

const sumFail = await req("POST", "/api/summarize", { id }, "test-token");
t("LLM 调用失败返回结构化错误", sumFail.status === 502 && sumFail.data.error.includes("总结生成失败"));
await req("DELETE", "/api/item/" + biliSave.data.id, null, "test-token");
t("删除成功", (await req("DELETE", "/api/item/" + id, null, "test-token")).data.ok === true);
t("删除后列表为空", (await req("GET", "/api/items", null, "test-token")).data.items.length === 0);

// userscript 分发路由(公开,免 token)
{
  const r = await mod.fetch(new Request("https://w.dev/userscript.user.js"), env);
  const text = await r.text();
  t("userscript 路由免鉴权可访问", r.status === 200);
  t("userscript 内容为脚本本体(含版本头)", text.includes("==UserScript==") && /@version\s+0\.\d+\.\d+/.test(text));
  t("userscript 响应头正确", (r.headers.get("content-type") || "").includes("text/javascript") && r.headers.get("cache-control") === "no-cache");
}

// ---- 分组 ----
{
  const aid = (await req("POST", "/api/save", { url: "https://example.com/grouped", title: "分组测试条目", content: "正文" }, "test-token")).data.id;
  await req("POST", "/api/groups", { action: "create", name: "技术" }, "test-token");
  t("重复分组名被拒", (await req("POST", "/api/groups", { action: "create", name: "技术" }, "test-token")).status === 400);
  t("保留名「默认」被拒", (await req("POST", "/api/groups", { action: "create", name: "默认" }, "test-token")).status === 400);
  const gl = await req("GET", "/api/groups", null, "test-token");
  const tech = gl.data.groups.find((g) => g.name === "技术");
  t("分组列表含默认组与新建组", gl.data.groups[0].id === "default" && !!tech);
  t("分组接口需要鉴权", (await req("GET", "/api/groups", null)).status === 401);

  const mv = await req("POST", "/api/group/assign", { ids: [aid], group_id: tech.id }, "test-token");
  t("批量移动资料成功", mv.data.ok === 1 && mv.data.fail === 0);
  const listAfter = await req("GET", "/api/items", null, "test-token");
  t("列表返回 group_id", listAfter.data.items.find((x) => x.id === aid).group_id === tech.id);
  t("移动到不存在的分组被拒", (await req("POST", "/api/group/assign", { ids: [aid], group_id: "nope" }, "test-token")).status === 400);
  t("超量 ids 被拒", (await req("POST", "/api/group/assign", { ids: Array(201).fill(aid), group_id: "default" }, "test-token")).status === 400);

  t("改名成功", (await req("POST", "/api/groups", { action: "rename", id: tech.id, name: "前端" }, "test-token")).data.ok === true);
  t("删除分组成功", (await req("POST", "/api/groups", { action: "delete", id: tech.id }, "test-token")).data.ok === true);
  const listStale = await req("GET", "/api/items", null, "test-token");
  t("删除分组后失效 group_id 按默认组解释", listStale.data.items.find((x) => x.id === aid).group_id === "default");
}

// ---- 知识库元数据分页 ----
{
  await req("POST", "/api/save", { url: "https://example.com/b", title: "第二条", content: "x".repeat(3000), group_id: "default" }, "test-token");
  const m1 = await req("GET", "/api/kb/metadata?limit=1", null, "test-token");
  t("元数据分页返回 total 与游标", m1.data.total === 2 && m1.data.items.length === 1 && m1.data.next_cursor === "1");
  t("元数据含摘要与分组、不含正文", typeof m1.data.items[0].summary === "string" && m1.data.items[0].group_id === "default" && !("content" in m1.data.items[0]));
  t("metadata 需要鉴权", (await req("GET", "/api/kb/metadata", null)).status === 401);
}

// ---- 聊天代理 ----
{
  const realFetch = globalThis.fetch;
  try {
    await req("POST", "/api/settings", { api_base: "https://fake.llm/v1", api_key: "sk-1234567890", model: "m1" }, "test-token");
    globalThis.fetch = async (u, init) => {
      const sent = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "回答", tool_calls: sent.tools ? [{ id: "t1", type: "function", function: { name: "search_kb", arguments: "{}" } }] : undefined } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const chat1 = await req("POST", "/api/chat", { messages: [{ role: "user", content: "你好" }] }, "test-token");
    t("聊天代理透传响应", chat1.status === 200 && chat1.data.choices[0].message.content === "回答");
    const chat2 = await req("POST", "/api/chat", {
      messages: [{ role: "user", content: "?" }],
      tools: [{ type: "function", function: { name: "search_kb", parameters: { type: "object", properties: {} } } }],
      model: "override-m",
    }, "test-token");
    t("聊天代理透传 tool_calls 与模型覆盖", chat2.data.choices[0].message.tool_calls.length === 1);
    t("非法形状 tools 被拒", (await req("POST", "/api/chat", { messages: [{ role: "user", content: "?" }], tools: [{ type: "function" }] }, "test-token")).status === 400);
    t("空 messages 被拒", (await req("POST", "/api/chat", { messages: [] }, "test-token")).status === 400);
    t("非法 role 被拒", (await req("POST", "/api/chat", { messages: [{ role: "admin", content: "x" }] }, "test-token")).status === 400);
    t("tool 消息缺 tool_call_id 被拒", (await req("POST", "/api/chat", { messages: [{ role: "tool", content: "x" }] }, "test-token")).status === 400);
    t("聊天接口需要鉴权", (await req("POST", "/api/chat", { messages: [{ role: "user", content: "x" }] })).status === 401);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
