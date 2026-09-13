// Webbin Worker — 油猴脚本与 PC 归档脚本的共享后端
// KV 结构:
//   settings      → { api_base, api_key, model }
//   item:<id>     → { id, url, title, site, type, content, created_at,
//                     summary?, summarized_at?, status, archive? }
// 鉴权:请求头 x-token === 环境变量 TOKEN(部署前在 wrangler.toml 里修改)
// /userscript.user.js 为公开路由(免鉴权),部署即最新,替代 jsDelivr 分发

import userscriptSource from "./userscript/webbin.user.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-token",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
};

const SUMMARY_PROMPT = [
  "你是一个信息整理助手。用户会给你一篇网页正文,请用中文输出结构化总结,格式为:",
  "## 核心结论\n(1-3 句话说清这个内容讲什么、价值在哪)",
  "## 要点\n(- 按逻辑顺序列出 3-8 个关键要点,保留具体数据/结论/方法名,不要空泛)",
  "## 值得记住的细节\n(可选,最多 3 条,如金句、工具名、引用来源)",
  "只输出总结本身,不要复述原文。",
].join("\n");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function bad(msg, status = 400) {
  return json({ error: msg }, status);
}

function maskKey(key) {
  if (!key) return "";
  return key.length <= 6 ? "***" : key.slice(0, 3) + "***" + key.slice(-4);
}

function newId() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function getSettings(KV) {
  const s = await KV.get("settings", "json");
  return s || { api_base: "", api_key: "", model: "" };
}

// 自定义分组列表(KV key "groups" → [{id,name}]);默认组 id 固定 "default",不入列表、不可删改
async function getGroups(KV) {
  const g = await KV.get("groups", "json");
  return Array.isArray(g) ? g : [];
}

function itemGroupId(it) {
  return (it && it.group_id) || "default";
}

// 读侧归一化:分组被删除后,条目里残留的失效 group_id 按默认组解释(避免批量重写)
function groupResolver(KV) {
  return getGroups(KV).then((groups) => {
    const valid = new Set(groups.map((g) => g.id));
    return (it) => {
      const g = itemGroupId(it);
      return g === "default" || valid.has(g) ? g : "default";
    };
  });
}

async function callLLM(settings, system, user) {
  const base = settings.api_base.replace(/\/+$/, "");
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + settings.api_key,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    throw new Error(`LLM 接口返回 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LLM 返回了空内容");
  return content;
}

async function listItems(KV) {
  const out = [];
  let cursor;
  do {
    const page = await KV.list({ prefix: "item:", cursor });
    out.push(...page.keys.map((k) => k.name.slice(5)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const KV = env.KV;

    if (path === "/") {
      return json({ app: "webbin", ok: true, hint: "服务正常,请通过油猴脚本或 PC 脚本访问" });
    }

    // 油猴脚本分发(公开):版本检查与安装都指向这里,部署即最新
    if (path === "/userscript.user.js") {
      return new Response(userscriptSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "access-control-allow-origin": "*",
        },
      });
    }

    // 鉴权
    const token = request.headers.get("x-token") || url.searchParams.get("token");
    if (!env.TOKEN || token !== env.TOKEN) return bad("token 无效", 401);

    // ---- 保存 ----
    if (path === "/api/save" && request.method === "POST") {
      const body = await request.json();
      const urlStr = String(body.url || "").trim();
      if (!/^https?:\/\//.test(urlStr)) return bad("url 不合法");
      // 可选 group_id:给非默认值时校验存在性,旧客户端不传则入默认组
      let gid = "default";
      if (body.group_id && body.group_id !== "default") {
        const groups = await getGroups(KV);
        if (groups.some((g) => g.id === body.group_id)) gid = body.group_id;
      }
      const item = {
        id: newId(),
        url: urlStr,
        title: String(body.title || urlStr).slice(0, 500),
        site: String(body.site || new URL(urlStr).hostname),
        type: body.type === "bilibili" ? "bilibili" : "web",
        content: String(body.content || ""),
        group_id: gid,
        created_at: Date.now(),
        summary: "",
        summarized_at: 0,
        status: "pending",
        archive: null,
      };
      await KV.put("item:" + item.id, JSON.stringify(item));
      // 返回完整条目:客户端本地合并进列表,规避 KV 最终一致性(最长约60s)带来的显示延迟
      return json(item);
    }

    // ---- 列表 ----
    if (path === "/api/items" && request.method === "GET") {
      const ids = await listItems(KV);
      const resolveGroup = await groupResolver(KV);
      const items = [];
      for (const id of ids) {
        const it = await KV.get("item:" + id, "json");
        if (!it) continue;
        const full = url.searchParams.get("full") === "1";
        items.push(
          full
            ? it
            : {
                id: it.id,
                url: it.url,
                title: it.title,
                site: it.site,
                type: it.type,
                group_id: resolveGroup(it),
                created_at: it.created_at,
                has_summary: !!it.summary,
                has_content: !!it.content,
                status: it.status,
                archive: it.archive,
              },
        );
      }
      items.sort((a, b) => b.created_at - a.created_at);
      return json({ items });
    }

    // ---- 单条 ----
    const mItem = path.match(/^\/api\/item\/([a-f0-9]+)$/);
    if (mItem) {
      const it = await KV.get("item:" + mItem[1], "json");
      if (!it) return bad("条目不存在", 404);
      if (request.method === "GET") return json(it);
      if (request.method === "DELETE") {
        await KV.delete("item:" + mItem[1]);
        return json({ ok: true });
      }
    }

    // ---- 手动生成总结 ----
    if (path === "/api/summarize" && request.method === "POST") {
      try {
        const { id } = await request.json();
        const it = await KV.get("item:" + id, "json");
        if (!it) return bad("条目不存在", 404);
        if (!it.content) return bad("该条目没有正文(B站视频请等 PC 归档时生成字幕总结)");
        const settings = await getSettings(KV);
        if (!settings.api_base || !settings.api_key || !settings.model)
          return bad("请先在设置中配置 api_base / api_key / model");
        const summary = await callLLM(settings, SUMMARY_PROMPT, `标题:${it.title}\n\n${it.content}`);
        it.summary = summary;
        it.summarized_at = Date.now();
        await KV.put("item:" + id, JSON.stringify(it));
        return json({ summary });
      } catch (e) {
        return bad("总结生成失败: " + e.message, 502);
      }
    }

    // ---- PC 归档回写状态(可附带总结) ----
    if (path === "/api/status" && request.method === "POST") {
      const body = await request.json();
      const it = await KV.get("item:" + body.id, "json");
      if (!it) return bad("条目不存在", 404);
      it.status = body.status === "pending" ? "pending" : "archived";
      it.archive = body.archive || null;
      if (body.summary) {
        it.summary = body.summary;
        it.summarized_at = Date.now();
      }
      await KV.put("item:" + body.id, JSON.stringify(it));
      return json({ ok: true });
    }

    // ---- 分组管理 ----
    if (path === "/api/groups" && request.method === "GET") {
      return json({ groups: [{ id: "default", name: "默认", builtin: true }, ...await getGroups(KV)] });
    }
    if (path === "/api/groups" && request.method === "POST") {
      const body = await request.json();
      const groups = await getGroups(KV);
      const name = String(body.name || "").trim().slice(0, 50);
      if (body.action === "create") {
        if (!name) return bad("分组名不能为空");
        if (name === "默认") return bad("不能使用保留名「默认」");
        if (groups.length >= 50) return bad("分组数量已达上限(50)");
        if (groups.some((g) => g.name === name)) return bad("分组名已存在");
        groups.push({ id: newId(), name });
        await KV.put("groups", JSON.stringify(groups));
        return json({ ok: true });
      }
      if (body.action === "rename") {
        const g = groups.find((x) => x.id === body.id);
        if (!g) return bad("分组不存在");
        if (!name || name === "默认" || (name !== g.name && groups.some((x) => x.name === name)))
          return bad("分组名不可用");
        g.name = name;
        await KV.put("groups", JSON.stringify(groups));
        return json({ ok: true });
      }
      if (body.action === "delete") {
        // 资料保留原 group_id,读取时按默认组解释,避免批量重写
        const next = groups.filter((x) => x.id !== body.id);
        if (next.length === groups.length) return bad("分组不存在");
        await KV.put("groups", JSON.stringify(next));
        return json({ ok: true });
      }
      return bad("未知操作");
    }

    // 批量移动资料到分组(旧条目缺 group_id 视为默认组,此处显式写入)
    if (path === "/api/group/assign" && request.method === "POST") {
      const body = await request.json();
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
      if (!ids.length || ids.length > 200) return bad("ids 不合法(1~200 条)");
      const groups = await getGroups(KV);
      const gid = body.group_id === "default" ? "default" : (groups.find((g) => g.id === body.group_id) || {}).id;
      if (!gid) return bad("目标分组不存在");
      let ok = 0, fail = 0;
      for (const id of ids) {
        const it = await KV.get("item:" + id, "json");
        if (!it) { fail++; continue; }
        it.group_id = gid;
        await KV.put("item:" + id, JSON.stringify(it));
        ok++;
      }
      return json({ ok, fail });
    }

    // ---- 知识库检索元数据(有界分页;子请求受 Worker 限额约束,单页 ≤40 条) ----
    if (path === "/api/kb/metadata" && request.method === "GET") {
      const ids = (await listItems(KV)).sort(); // 按稳定 id 排序保证分页一致,客户端拿 created_at 自行排序
      const resolveGroup = await groupResolver(KV);
      const offset = Math.max(0, parseInt(url.searchParams.get("cursor") || "0", 10) || 0);
      const limit = Math.min(40, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10) || 25));
      const page = ids.slice(offset, offset + limit);
      const items = [];
      for (const id of page) {
        const it = await KV.get("item:" + id, "json");
        if (!it) continue;
        items.push({
          id: it.id,
          title: it.title,
          url: it.url,
          site: it.site,
          type: it.type,
          group_id: resolveGroup(it),
          created_at: it.created_at,
          has_content: !!it.content,
          summary: String(it.summary || "").slice(0, 2000),
        });
      }
      const next = offset + page.length;
      return json({ total: ids.length, items, next_cursor: next < ids.length ? String(next) : null });
    }

    // ---- 知识库对话代理(原生工具调用;messages 由油猴端组装,服务端只校验并转发) ----
    if (path === "/api/chat" && request.method === "POST") {
      const body = await request.json();
      const msgs = Array.isArray(body.messages) ? body.messages : null;
      if (!msgs || !msgs.length || msgs.length > 64) return bad("messages 不合法(1~64 条)");
      for (const m of msgs) {
        if (!m || !["system", "user", "assistant", "tool"].includes(m.role)) return bad("消息 role 不合法");
        if (typeof m.content !== "string" || m.content.length > 200000) return bad("消息内容过大");
        if (m.role === "tool" && typeof m.tool_call_id !== "string") return bad("tool 消息缺少 tool_call_id");
      }
      let tools = null;
      if (body.tools != null) {
        if (!Array.isArray(body.tools) || body.tools.length > 32) return bad("tools 不合法");
        for (const t of body.tools) {
          if (!t || t.type !== "function" || !t.function
            || typeof t.function.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.function.name)
            || (t.function.parameters != null && typeof t.function.parameters !== "object")) {
            return bad("tools 条目不合法");
          }
        }
        tools = body.tools;
      }
      const settings = await getSettings(KV);
      if (!settings.api_base || !settings.api_key) return bad("请先在设置中配置 api_base / api_key");
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 200) : settings.model;
      if (!model) return bad("未配置模型,请先在设置中选择模型");
      const payload = { model, messages: msgs };
      if (tools) {
        payload.tools = tools;
        payload.tool_choice = "auto"; // 显式声明,部分中转站不默认按 auto 处理
      }
      if (JSON.stringify(payload).length > 600000) return bad("请求过大,请缩小对话范围或开新会话");
      const base = settings.api_base.replace(/\/+$/, "");
      try {
        const resp = await fetch(base + "/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + settings.api_key },
          body: JSON.stringify(payload),
        });
        const text = await resp.text();
        if (!resp.ok) return bad(`模型接口返回 ${resp.status}: ${text.slice(0, 300)}`, 502);
        // 透传原文,保留 assistant.tool_calls 等字段
        return new Response(text, { status: 200, headers: JSON_HEADERS });
      } catch (e) {
        return bad("模型请求失败: " + e.message, 502);
      }
    }

    // ---- LLM 设置 ----
    if (path === "/api/settings") {
      const settings = await getSettings(KV);
      if (request.method === "GET") {
        return json({
          api_base: settings.api_base,
          model: settings.model,
          api_key_masked: maskKey(settings.api_key),
          configured: !!(settings.api_base && settings.api_key && settings.model),
        });
      }
      if (request.method === "POST") {
        const body = await request.json();
        const next = {
          api_base: String(body.api_base ?? settings.api_base).trim(),
          // key 传空/掩码/未变时保留原值
          api_key:
            !body.api_key || body.api_key.includes("***") ? settings.api_key : String(body.api_key).trim(),
          model: String(body.model ?? settings.model).trim(),
        };
        await KV.put("settings", JSON.stringify(next));
        return json({ ok: true, api_key_masked: maskKey(next.api_key) });
      }
    }

    // ---- 拉取模型列表(Worker 代理,避免浏览器 CORS) ----
    if (path === "/api/models" && request.method === "POST") {
      const settings = await getSettings(KV);
      if (!settings.api_base || !settings.api_key) return bad("请先保存 api_base 和 api_key");
      try {
        const base = settings.api_base.replace(/\/+$/, "");
        const resp = await fetch(base + "/models", {
          headers: { authorization: "Bearer " + settings.api_key },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const models = (data.data || []).map((x) => x.id).filter(Boolean).sort();
        return json({ models, current: settings.model });
      } catch (e) {
        return bad("拉取模型列表失败: " + e.message + "(可直接手动输入模型名)");
      }
    }

    return bad("接口不存在: " + path, 404);
  },
};
