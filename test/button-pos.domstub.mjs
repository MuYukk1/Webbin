// 最小 DOM 桩:跑通 webbin.user.js 启动路径 + 悬浮球定位/拖动/重置/resize 逻辑
// 语义对齐浏览器:position:fixed 元素 offsetParent 为 null,offsetLeft/offsetTop 即视口坐标;
// left/top 为空声明时按 right/bottom 锚点反推
import fs from "node:fs";
import vm from "node:vm";

let CURRENT_VIEW = { w: 0, h: 0 };

class El {
  constructor(tag, text) {
    this.tagName = String(tag).toUpperCase();
    this._view = CURRENT_VIEW; // right/bottom 反推需要当前视口
    this.children = [];
    this.parentElement = null;
    this._attrs = {};
    this._props = {};
    this._listeners = {};
    this._text = text == null ? "" : String(text);
    this.title = "";
    this.offsetParent = null;
    this._style = mkStyle(this);
  }
  get style() { return this._style; }
  // 与浏览器一致:textContent 聚合自身文本与后代文本
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n.tagName === "HTML"; }
  get offsetLeft() {
    const L = parseFloat(this._props.left);
    if (!Number.isNaN(L)) return Math.round(L);
    const R = parseFloat(this._props.right);
    return Number.isNaN(R) ? 0 : Math.round(this._view.w - R - this.offsetWidth);
  }
  get offsetTop() {
    const T = parseFloat(this._props.top);
    if (!Number.isNaN(T)) return Math.round(T);
    const B = parseFloat(this._props.bottom);
    return Number.isNaN(B) ? 0 : Math.round(this._view.h - B - this.offsetHeight);
  }
  get offsetWidth() { return Math.round(parseFloat(this._props.width) || 0); }
  get offsetHeight() { return Math.round(parseFloat(this._props.height) || 0); }
  setAttribute(k, v) { this._attrs[k] = String(v); if (k === "id") this.id = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
  dispatch(type, ev) {
    const e = Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, ev);
    (this._listeners[type] || []).forEach((f) => f.call(this, e));
  }
  fire(type, ev) { this.dispatch(type, ev); }
  append(...nodes) {
    for (const n of nodes.flat()) {
      if (n == null) continue;
      const node = typeof n === "string" ? new El("#text", n) : n;
      node.parentElement = this;
      this.children.push(node);
    }
  }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...n) { this.children = []; this._text = ""; this.append(...n); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); }
  setPointerCapture() {}
  releasePointerCapture() {}
  closest() { return null; }
  matches() { return false; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
function mkStyle(el) {
  const props = {};
  return {
    setProperty(k, v) { props[k] = String(v); layout(el, k, String(v)); },
    getPropertyValue(k) { return props[k] || ""; },
    removeProperty(k) { delete props[k]; delete el._props[k]; },
    // 供测试读取全部已设声明:e._props 只跟踪影响布局的几个属性
    all() { return { ...props }; },
  };
}
// 只关心影响布局的四个属性;其余(position/z-index/背景等)不影响可见性判定
function layout(el, k, v) { if (["left", "top", "right", "bottom", "width", "height"].includes(k)) el._props[k] = v; }

export function runScript({ innerWidth, innerHeight, storeBox, isMobile = false, faithfulStore = false, dropDeleteApi = false }) {
  // storeBox:跨次加载共享的存储盒(模拟 GM 存储的持久化);
  // faithfulStore:模拟"写 null 会被序列化成字符串"的管理器(如 Greasemonkey 的 JSON 存储)
  if (!storeBox.raw) {
    storeBox.raw = { ...(storeBox.init || {}) };
    if (faithfulStore) for (const k of Object.keys(storeBox.raw)) storeBox.raw[k] = JSON.stringify(storeBox.raw[k]);
  }
  const rawStore = storeBox.raw;
  const docEl = new El("html");
  const body = new El("body");
  body.parentElement = docEl;
  docEl.children.push(body);
  const head = new El("head");
  head.parentElement = docEl;
  docEl.children.push(head);
  const view = { w: innerWidth, h: innerHeight };
  CURRENT_VIEW = view;
  const menus = [];
  const resizeFns = [];
  const document = {
    documentElement: docEl, body, head, title: "t",
    createElement: (t) => new El(t),
    createTextNode: (t) => Object.assign(new El("#text"), { textContent: t }),
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: (id) => {
      let hit = null;
      const walk = (n) => { for (const c of n.children || []) { if (!hit && (c.id === id || c._attrs.id === id)) hit = c; walk(c); } };
      walk(docEl);
      return hit;
    },
    addEventListener() {}, removeEventListener() {},
    cloneNode() { return document; },
  };
  const env = {
    document,
    location: { href: "https://example.com/" },
    get innerWidth() { return view.w; },
    set innerWidth(v) { view.w = v; },
    get innerHeight() { return view.h; },
    set innerHeight(v) { view.h = v; },
    matchMedia: (q) => ({ matches: isMobile && /pointer:\s*coarse/.test(q), addEventListener() {}, addListener() {} }),
    addEventListener: (t, fn) => { if (t === "resize") resizeFns.push(fn); },
    removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => { fn(0); return 0; },
    console,
    GM_getValue: (k, d) => {
      if (!(k in rawStore)) return d;
      return faithfulStore ? JSON.parse(rawStore[k]) : rawStore[k];
    },
    GM_setValue: (k, v) => { rawStore[k] = faithfulStore ? JSON.stringify(v) : v; },
    GM_deleteValue: (k) => { delete rawStore[k]; },
    GM_registerMenuCommand: (name, fn) => { menus.push([name, fn]); },
    GM_addStyle: () => {},
    GM_xmlhttpRequest: () => ({ abort() {} }),
  };
  env.window = env;
  env.globalThis = env;
  if (dropDeleteApi) delete env.GM_deleteValue; // 模拟未授予 GM_deleteValue 的管理器

  const src = fs.readFileSync(new URL("../userscript/webbin.user.js", import.meta.url), "utf8");
  const ctx = vm.createContext(env);
  vm.runInContext(src, ctx, { filename: "webbin.user.js" });

  // 与线上同一套判定:data-wi-ui=1 且 title 为悬浮球(排除面板遮罩)
  const all = [];
  const walk = (n) => { for (const c of n.children || []) { if (c._attrs["data-wi-ui"] != null) all.push(c); walk(c); } };
  walk(docEl);
  const btn = all.find((el) => el.title === "Webbin 收集箱") || null;
  const decode = (v) => (faithfulStore ? JSON.parse(v) : v);
  const publicStore = () => Object.fromEntries(Object.entries(rawStore).map(([k, v]) => [k, decode(v)]));
  return { env, btn, menus, resizeFns, docEl, view, get store() { return publicStore(); }, raw: rawStore };
}

// 视口内判定:与视口矩形有交集才算"看得见"
export function visible(el, w, h) {
  if (!el) return false;
  const x = el.offsetLeft, y = el.offsetTop;
  return x < w && y < h && x + el.offsetWidth > 0 && y + el.offsetHeight > 0;
}

// ---- 驱动真实面板 DOM 的小工具 ----

export function* walk(el) {
  yield el;
  for (const c of el.children || []) yield* walk(c);
}

export function findAll(root, pred) {
  return [...walk(root)].filter((e) => e.tagName !== "#TEXT" && pred(e));
}

// 精确匹配文本的按钮/元素(与 chat-loop.test.mjs 的 byText 同语义)
export function byText(root, txt, tag) {
  return findAll(root, (e) => (!tag || e.tagName === tag) && (e.textContent || "").trim() === txt)[0];
}

// 面板结构固定为 [tabs, body, footer];直接从标签按钮所在行定位,避免遍历到宿主页其他 DIV
export function panelOf(root) {
  const tabsRow = findAll(root, (e) => e.tagName === "DIV" && e.children.length === 4 && e.children.every((c) => c.tagName === "BUTTON"))[0];
  return tabsRow?.parentElement || null;
}

export function tabButton(root, label) {
  const panel = panelOf(root);
  return panel ? panel.children[0].children.find((b) => (b.textContent || "").trim() === label) : undefined;
}

export function scrollBodyOf(root) {
  return panelOf(root)?.children[1] || null;
}

export function click(el) { el.fire("click"); }
export const settle = () => new Promise((r) => setTimeout(r, 0));
