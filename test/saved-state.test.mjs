// 驱动真实面板,覆盖关闭后的监听器释放、跨 Worker 隔离和缓存失败反馈。
import assert from "node:assert/strict";
import { runScript, findAll, byText, tabButton, scrollBodyOf, click, settle } from "./button-pos.domstub.mjs";

const A = "https://a.example.com";
const B = "https://b.example.com";
const defaultGroup = { id: "default", name: "默认", builtin: true };
const item = (id) => ({ id, title: `资料 ${id}`, url: `https://example.com/${id}`, site: "example.com", group_id: "default", created_at: 1 });
let checks = 0;
function check(name, result) { assert.ok(result, name); checks++; console.log("  ✓ " + name); }

function setup(init = {}) {
  const script = runScript({
    innerWidth: 1280, innerHeight: 800,
    href: "https://www.bilibili.com/bangumi/play/ep1", title: "测试链接",
    storeBox: { init: { worker: A, token: "test", ...init } },
  });
  const requests = [];
  script.env.GM_xmlhttpRequest = (request) => {
    const url = new URL(request.url);
    const entry = {
      worker: url.origin, path: url.pathname, request,
      reply: (body) => request.onload({ status: 200, responseText: JSON.stringify(body) }),
    };
    requests.push(entry);
    if (url.pathname === "/api/settings") queueMicrotask(() => entry.reply({}));
    if (url.pathname === "/userscript.user.js") queueMicrotask(() => entry.reply({}));
    if (url.pathname === "/api/save") {
      queueMicrotask(() => entry.reply({ ...item(url.origin === B ? "saved-b" : "saved-a"), ...JSON.parse(request.data) }));
    }
    return { abort() {} };
  };
  // 同步完成关闭动画,避免测试时依赖浏览器绘制与真实计时器。
  script.env.setTimeout = (fn) => { fn(); return 0; };
  const toggle = script.menus.find(([name]) => name === "打开收集箱")[1];
  const body = () => scrollBodyOf(script.docEl);
  const selects = () => findAll(body(), (e) => e.tagName === "SELECT");
  const switchWorker = (worker) => {
    click(tabButton(script.docEl, "设置"));
    const input = findAll(body(), (e) => e.tagName === "INPUT" && e.placeholder === "https://webbin.xxx.workers.dev")[0];
    assert.ok(input, "设置页 Worker 输入框存在");
    input.value = worker;
    click(byText(body(), "保存连接信息", "BUTTON"));
  };
  return { script, requests, toggle, body, selects, switchWorker };
}

console.log("分组监听器生命周期与初次选择");
{
  const app = setup({ save_group_id: "ga" });
  const retired = [];
  for (let i = 0; i < 3; i++) {
    app.toggle();
    for (const select of app.selects()) {
      let updates = 0;
      const replace = select.replaceChildren.bind(select);
      select.replaceChildren = (...nodes) => { updates++; replace(...nodes); };
      retired.push(() => updates);
    }
    check("分组加载前下拉显示存在的默认选项", app.selects().every((s) => s.value === "default" && s.children.some((o) => o.value === s.value)));
    app.toggle();
  }
  app.toggle();
  check("加载期间不覆盖记忆的自定义分组", app.script.store.save_group_id === "ga");
  app.requests.find((r) => r.path === "/api/groups").reply({ groups: [defaultGroup, { id: "ga", name: "A 分组" }] });
  await settle();
  check("关闭面板的选择器不再收到分组更新", retired.length === 6 && retired.every((getUpdates) => getUpdates() === 0));
  check("重开面板后两个选择器都恢复记忆分组", app.selects().length === 2 && app.selects().every((s) => s.value === "ga"));
  app.selects()[0].value = "default";
  app.selects()[0].fire("change");
  check("有效面板的两个选择器同步且持久化选择", app.selects().every((s) => s.value === "default") && app.script.store.save_group_id === "default");
}
{
  const app = setup({ save_group_id: "deleted" });
  app.toggle();
  app.requests.find((r) => r.path === "/api/groups").reply({ groups: [defaultGroup] });
  await settle();
  check("失效记忆分组通过统一设置逻辑落盘为默认", app.script.store.save_group_id === "default" && app.selects().every((s) => s.value === "default"));
}

console.log("Worker 切换和迟到响应");
{
  const app = setup({ saved_items_cache_v1: { worker: A, items: [item("cached-a")] } });
  app.toggle();
  click(tabButton(app.script.docEl, "已保存"));
  const oldItems = app.requests.find((r) => r.path === "/api/items" && r.worker === A);
  const oldGroups = app.requests.find((r) => r.path === "/api/groups" && r.worker === A);
  check("A 连接立即显示自己的缓存", app.body().textContent.includes("资料 cached-a"));
  app.switchWorker(B);
  check("切换连接立即清空内存对应的持久缓存", app.script.store.saved_items_cache_v1.worker === B && app.script.store.saved_items_cache_v1.items === null);
  click(tabButton(app.script.docEl, "已保存"));
  check("B 连接首帧不显示 A 缓存", !app.body().textContent.includes("资料 cached-a"));
  const bGroups = app.requests.find((r) => r.path === "/api/groups" && r.worker === B);
  bGroups.reply({ groups: [defaultGroup, { id: "gb", name: "B 分组" }] });
  app.requests.find((r) => r.path === "/api/items" && r.worker === B).reply({ items: [item("b")] });
  await settle();
  oldGroups.reply({ groups: [defaultGroup, { id: "ga", name: "A 分组" }] });
  await settle();
  click(tabButton(app.script.docEl, "当前页"));
  check("旧分组响应不会覆盖 B 分组缓存", app.selects().every((s) => s.children.some((o) => o.value === "gb") && !s.children.some((o) => o.value === "ga")));
  click(byText(app.body(), "保存到收集箱", "BUTTON"));
  await settle();
  const bCache = app.script.store.saved_items_cache_v1;
  check("B 新保存只合并到 B 缓存", bCache.worker === B && bCache.items.some((x) => x.id === "saved-b") && !bCache.items.some((x) => x.id === "cached-a"));
  app.switchWorker(A);
  click(tabButton(app.script.docEl, "已保存"));
  oldItems.reply({ items: [item("late-a")] });
  await settle();
  check("A→B→A 后旧 A 请求也不能写回缓存", app.script.store.saved_items_cache_v1.items === null && !app.body().textContent.includes("资料 late-a"));
  app.requests.filter((r) => r.path === "/api/items" && r.worker === A).at(-1).reply({ items: [item("fresh-a")] });
  await settle();
  check("切回 A 只接收新请求且不混入 B 的本地暂存", app.script.store.saved_items_cache_v1.items.length === 1 && app.script.store.saved_items_cache_v1.items[0].id === "fresh-a");
}

console.log("缓存刷新反馈与分组筛选恢复");
{
  const app = setup({
    saved_list_group_v1: "ga",
    saved_items_cache_v1: { worker: A, items: [{ ...item("cached-a"), group_id: "ga" }] },
  });
  app.toggle();
  click(tabButton(app.script.docEl, "已保存"));
  check("后台刷新期间标明本地缓存", app.body().textContent.includes("已显示本地缓存"));
  app.requests.find((r) => r.path === "/api/groups").reply({ groups: [defaultGroup, { id: "ga", name: "A 分组" }] });
  await settle();
  check("分组迟到时仍恢复上次的列表筛选", app.selects()[0].value === "ga" && app.script.store.saved_list_group_v1 === "ga");
  app.requests.find((r) => r.path === "/api/items").request.onerror();
  await settle();
  check("自动刷新失败时保留资料并明确显示缓存状态", app.body().textContent.includes("资料 cached-a") && app.body().textContent.includes("刷新失败,当前显示本地缓存"));
  click(byText(app.body(), "刷新", "BUTTON"));
  app.requests.filter((r) => r.path === "/api/items").at(-1).reply({ items: [{ ...item("fresh"), group_id: "ga" }] });
  await settle();
  check("重试成功后清除旧错误并显示新结果", app.body().textContent.includes("资料 fresh") && app.body().textContent.includes("已更新") && !app.body().textContent.includes("刷新失败"));
}

console.log(`\n${checks} passed, 0 failed`);
