// 油猴对话 Agent 循环端到端测试:vm 加载真实 webbin.user.js,
// 假 DOM + 假 GM 环境驱动「打开面板 → 对话 Tab → 发送 → 两轮工具 → 强制收尾回答」。
// 覆盖 0.8.14 事故场景:模型分两段读完 3 条长资料后,收尾请求必须仍带 tools
// 且声明 tool_choice:"none"(中转站按是否带 tools 路由渠道,去掉 tools 会被分到
// 不可用渠道无声挂起);以及运行中关闭/重开面板后最终回答不丢(内存态权威)。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../userscript/webbin.user.js", import.meta.url)), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let ok = false;
    try { ok = fn(); } catch { /* 元素还没出现,继续等 */ }
    if (ok) return;
    await sleep(10);
  }
  throw new Error("until 等待超时");
}

// ---- 迷你 DOM:只实现脚本真实用到的面 ----
class El {
  constructor(tag) {
    this.tagName = String(tag || "").toUpperCase();
    this.children = [];
    this.parent = null;
    this.listeners = Object.create(null);
    this.attrs = Object.create(null);
    this.text = "";
    this.value = ""; this.disabled = false; this.checked = false;
    this.title = ""; this.href = ""; this.type = ""; this.placeholder = "";
    this.scrollTop = 0; this.scrollHeight = 0;
    this.offsetLeft = 0; this.offsetTop = 0;
    const style = {};
    style.setProperty = (k, v) => { style[k] = String(v); };
    style.removeProperty = (k) => { delete style[k]; };
    this.style = style;
  }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.tagName === "HTML"; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.text = String(v == null ? "" : v);
  }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parent) return null;
    const i = this.parent.children.indexOf(this);
    return this.parent.children[i + 1] || null;
  }
  append(...nodes) {
    for (let n of nodes.flat()) {
      if (n == null) continue;
      if (typeof n === "string") { const tn = new El("#text"); tn.text = n; n = tn; }
      if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
      n.parent = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
  after(n) {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    n.parent = this.parent;
    this.parent.children.splice(i + 1, 0, n);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  fire(t, ev) {
    const e = { target: this, stopPropagation() {}, preventDefault() {}, ...(ev || {}) };
    for (const fn of [...(this.listeners[t] || [])]) fn(e);
  }
  click() { this.fire("click"); }
  setPointerCapture() {}
  releasePointerCapture() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  cloneNode() { return new El(this.tagName); }
}
// ---- 测试夹具数据:3 条 9900 字资料,复刻事故现场(首轮截断 → 次轮读余量 → 超预算强制收尾) ----
const META = ["a", "b", "c"].map((id, i) => ({
  id, title: `Jev视频${i + 1} · 字幕`, url: `https://www.bilibili.com/video/BV${id}`,
  site: "www.bilibili.com", type: "bilibili", group_id: "default", created_at: i + 1,
  has_content: true, summary: `第 ${i + 1} 个视频的摘要`,
}));
const FULL = Object.fromEntries(META.map((m) => [m.id, {
  ...m, summary: `第 ${m.id} 条:Jev 与金融的摘要`, content: "正".repeat(9900),
}]));

const tc = (id, item_id, extra) => ({
  id, type: "function",
  function: { name: "read_item", arguments: JSON.stringify({ item_id, ...(extra || {}) }) },
});

function makeNet() {
  const api = {
    counts: { item: 0, chat: 0 },
    chatCalls: [],
    held: null,
    resolveHeld(payload) {
      if (!api.held) throw new Error("没有被扣住的请求");
      const h = api.held; api.held = null;
      h.onload({ status: 200, responseText: JSON.stringify(payload) });
    },
    whenChatCalls(n) { return until(() => api.chatCalls.length >= n); },
  };
  function GM_xmlhttpRequest(d) {
    const finish = (status, obj) =>
      Promise.resolve().then(() => d.onload({ status, responseText: typeof obj === "string" ? obj : JSON.stringify(obj) }));
    const p = new URL(d.url).pathname;
    if (p.endsWith("/userscript.user.js")) { finish(200, "// ==UserScript==\n// @version 0.8.17\n// ==/UserScript=="); return { abort() {} }; }
    if (p === "/api/kb/metadata") { finish(200, { total: META.length, items: META, next_cursor: null }); return { abort() {} }; }
    if (p === "/api/groups") { finish(200, { groups: [] }); return { abort() {} }; }
    if (p === "/api/models") { finish(200, { models: ["m1"], current: "m1" }); return { abort() {} }; }
    if (p.startsWith("/api/item/")) {
      api.counts.item++;
      finish(200, FULL[p.split("/").pop()]);
      return { abort() {} };
    }
    if (p === "/api/chat") {
      api.counts.chat++;
      const body = JSON.parse(d.data);
      api.chatCalls.push(body);
      const n = api.chatCalls.length;
      if (n === 1) {
        finish(200, { choices: [{ message: { role: "assistant", content: "", tool_calls: [tc("t1", "a"), tc("t2", "b"), tc("t3", "c")] } }] });
      } else if (n === 2) {
        finish(200, { choices: [{ message: { role: "assistant", content: "", tool_calls: [tc("t4", "a", { cursor: 6000 }), tc("t5", "b", { cursor: 6000 }), tc("t6", "c", { cursor: 6000 })] } }] });
      } else if (n === 3) {
        api.held = d; // 收尾请求扣住,由测试手动放行(可精确插入"关闭面板"等时序)
      } else {
        finish(500, { error: "测试不应出现第 4 次模型调用" });
      }
      return { abort() {} };
    }
    finish(404, { error: "not found: " + p });
    return { abort() {} };
  }
  return { GM_xmlhttpRequest, api };
}

function seedSession() {
  return {
    worker: "https://w.dev",
    token: "t",
    chat_session_v1: {
      mode: "items", groups: [], itemIds: ["a", "b", "c"], messages: [],
      model: "", running: false, historyId: "", kbGroups: [], saved_at: Date.now(),
    },
  };
}
function boot(seed) {
  const gmStore = new Map(Object.entries(seed));
  const documentElement = new El("html");
  const head = new El("head");
  const body = new El("body");
  documentElement.append(head, body);
  const document = {
    title: "Example Page",
    documentElement, head, body,
    createElement: (t) => new El(t),
    createTextNode: (tx) => { const n = new El("#text"); n.text = String(tx); return n; },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const net = makeNet();
  const sandbox = {
    console, setTimeout, clearTimeout, queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder,
    document,
    location: { href: "https://example.com/page", hostname: "example.com", pathname: "/page", search: "" },
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: "chat-loop-test" },
    innerWidth: 1024, innerHeight: 768,
    GM_getValue: (k, d) => (gmStore.has(k) ? gmStore.get(k) : d),
    GM_setValue: (k, v) => gmStore.set(k, v === undefined ? v : JSON.parse(JSON.stringify(v))),
    GM_registerMenuCommand: () => {},
    GM_addStyle: () => {},
    GM_info: { script: { version: "0.8.17-test" } },
    GM_xmlhttpRequest: net.GM_xmlhttpRequest,
  };
  vm.runInNewContext(SRC, sandbox, { filename: "webbin.user.js" });
  return { documentElement, gmStore, net };
}

// ---- 驱动 helpers ----
function* walk(el) { yield el; for (const c of [...el.children]) yield* walk(c); }
function findAll(root, pred) { return [...walk(root)].filter((e) => e.isConnected && e.tagName !== "#text" && pred(e)); }
function byText(root, txt, tag) {
  return findAll(root, (e) => (!tag || e.tagName === tag) && e.textContent.trim() === txt)[0];
}
function openPanel(root) {
  const btn = findAll(root, (e) => e.title === "Webbin 收集箱")[0];
  btn.fire("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  btn.fire("pointerup", { clientX: 0, clientY: 0, pointerId: 1 });
}
function overlayOf(root) {
  return root.children.find((e) => e.listeners.click && e.listeners.click.length);
}
function msgsElOf(root) {
  return findAll(root, (e) => e.tagName === "DIV" && e.style.padding === "6px 2px")[0];
}
function sendQuestion(root, q) {
  const ta = findAll(root, (e) => e.tagName === "TEXTAREA")[0];
  ta.value = q;
  ta.fire("input");
  byText(root, "➤", "BUTTON").click();
}

let pass = 0, fail = 0;
function t(name, cond) { cond ? pass++ : fail++; console.log(cond ? "  ✓" : "  ✗", name); }
// ================= 场景 1:完整跑通两轮工具 + 强制收尾 =================
{
  const ANSWER = "三个视频分别讲了:Jev 的概率判断如何嵌入金融决策链……";
  const { documentElement, gmStore, net } = boot(seedSession());
  openPanel(documentElement);
  byText(documentElement, "对话", "BUTTON").click();
  sendQuestion(documentElement, "这三个视频,分别讲了jev和金融的什么内容");

  await net.api.whenChatCalls(3);
  const [c1, c2, c3] = net.api.chatCalls;
  t("前两轮带 tools 且不声明 tool_choice",
    Array.isArray(c1.tools) && c1.tools.length === 3 && c1.tool_choice === undefined
    && Array.isArray(c2.tools) && c2.tool_choice === undefined);
  t("收尾请求仍带 tools(中转站渠道路由不变)", Array.isArray(c3.tools) && c3.tools.length === 3);
  t("收尾请求声明 tool_choice:\"none\"", c3.tool_choice === "none");

  net.api.resolveHeld({ choices: [{ message: { role: "assistant", content: ANSWER } }] });
  await until(() => byText(documentElement, "➤", "BUTTON")); // 运行结束,发送键复位

  const msgs = msgsElOf(documentElement);
  t("最终回答已渲染", msgs.textContent.includes(ANSWER));
  t("没有报错/空回答痕迹", !msgs.textContent.includes("✗ 出错") && !msgs.textContent.includes("(模型返回了空回答)"));
  t("两轮读取状态行都在(首批已截断,共 6 行)",
    msgs.textContent.includes("已截断") && (msgs.textContent.match(/📄 读取/g) || []).length === 6);
  t("循环正常终止,没有第 4 次模型调用", net.api.chatCalls.length === 3);
  t("条目接口只拉 6 次(摘要注入 3 + 首轮工具 3;次轮命中正文缓存)", net.api.counts.item === 6);
  const saved = gmStore.get("chat_session_v1");
  t("最终回答已落盘到本地会话", !!(saved && saved.messages.some((m) => m.role === "assistant" && m.content === ANSWER)));
}

// ================= 场景 2:收尾请求在途时关闭并重开面板,回答不丢 =================
{
  const ANSWER2 = "这是重开面板后依然必须出现的最终回答。";
  const { documentElement, gmStore, net } = boot(seedSession());
  openPanel(documentElement);
  byText(documentElement, "对话", "BUTTON").click();
  sendQuestion(documentElement, "同样的问题");

  await net.api.whenChatCalls(3); // 收尾请求在途(被扣住)
  overlayOf(documentElement).fire("click"); // 点遮罩关闭面板
  await sleep(260); // 等关闭动画移除 DOM
  t("面板已关闭", !overlayOf(documentElement));

  openPanel(documentElement); // 重新打开,切回对话 Tab
  byText(documentElement, "对话", "BUTTON").click();
  const msgs2 = msgsElOf(documentElement);
  t("重开后运行中的进度仍在(工具状态行可见)", msgs2.textContent.includes("📄 读取"));
  t("运行中重开不会误报「被中断」", !msgs2.textContent.includes("被中断"));

  net.api.resolveHeld({ choices: [{ message: { role: "assistant", content: ANSWER2 } }] });
  await until(() => msgsElOf(documentElement).textContent.includes(ANSWER2));
  t("运行中重开面板后,最终回答依然渲染", true);
  const saved2 = gmStore.get("chat_session_v1");
  t("最终回答正确落盘(没有写进孤儿数组)", !!(saved2 && saved2.messages.some((m) => m.role === "assistant" && m.content === ANSWER2)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
