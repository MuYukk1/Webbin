// 面板标签切换后的滚动容器状态回归测试
// 复现并守住:已保存 → 对话 → 已保存 之后,列表必须仍能用滚轮滚动
import { runScript, findAll, panelOf, tabButton, scrollBodyOf, click, settle } from "./button-pos.domstub.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ""}`); }
};

const script = runScript({
  innerWidth: 1280, innerHeight: 800,
  storeBox: { init: { worker: "https://w.dev", token: "t" } },
});
const { docEl: root } = script;
script.env.GM_xmlhttpRequest = (request) => {
  const path = new URL(request.url).pathname;
  const item = { id: "ui1", title: "布局回归资料", site: "example.com", url: "https://example.com", created_at: 1, group_id: "default" };
  const data = path === "/api/items" ? { items: [item] } : path.startsWith("/api/item/") ? item : { groups: [] };
  queueMicrotask(() => request.onload({ status: 200, responseText: JSON.stringify(data) }));
  return { abort() {} };
};

// 打开面板:点悬浮球(无位移 = 点击)
const btn = findAll(root, (e) => e.title === "Webbin 收集箱")[0];
btn.fire("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
btn.fire("pointerup", { clientX: 0, clientY: 0, pointerId: 1 });

const state = () => {
  const body = scrollBodyOf(root);
  const css = body ? body.style.all() : {};
  // 滚轮实际能否滚动:overflow/overflow-y 任一为 hidden 就不行
  const blocked = css.overflow === "hidden" || css["overflow-y"] === "hidden";
  return { css, blocked };
};

console.log("面板标签切换后的滚动容器状态");
{
  const s = state();
  check("面板打开后默认(当前页)可滚动", !s.blocked && s.css.overflow === "auto", JSON.stringify(s.css));
}
{
  click(tabButton(root, "对话"));
  const s = state();
  check("对话 Tab 关闭 body 滚动(保留原设计)", s.blocked, JSON.stringify(s.css));
}
{
  click(tabButton(root, "已保存"));
  const s = state();
  check("对话 → 已保存 后列表可滚动(本次修复的缺陷)", !s.blocked && s.css.overflow === "auto", JSON.stringify(s.css));
  check("列表 Tab 顶部内边距仍归零(sticky 批量栏不露缝)", s.css.padding === "0 14px 14px", JSON.stringify(s.css));
}
{
  click(tabButton(root, "对话"));
  click(tabButton(root, "设置"));
  const s = state();
  check("对话 → 设置 后设置页可滚动", !s.blocked && s.css.overflow === "auto", JSON.stringify(s.css));
  check("设置页内边距为 14px", s.css.padding === "14px", JSON.stringify(s.css));
}
{
  click(tabButton(root, "已保存"));
  click(tabButton(root, "当前页"));
  click(tabButton(root, "已保存"));
  const s = state();
  check("反复来回切换后列表依然可滚动", !s.blocked && s.css.overflow === "auto", JSON.stringify(s.css));
}
{
  // 面板每次重建只注入一份滚动条样式,不得重复堆叠
  let count = 0;
  (function walk(e) { for (const c of e.children || []) { if (c.id === "webbin-scrollbar-style") count++; walk(c); } })(root);
  check("滚动条样式元素只有一个", count === 1, `count=${count}`);
}

await settle();
console.log("StashDock 布局与偏好回归");
const byButton = (text) => findAll(root, (e) => e.tagName === "BUTTON" && e.textContent.trim() === text)[0];
const panel = panelOf(root);
check("紧凑面板尺寸", panel.style.all().width === "min(94vw, 540px)" && panel.style.all().height === "min(84vh, 640px)");
click(tabButton(root, "当前页"));
{
  const details = findAll(root, (e) => e.tagName === "DETAILS")[0];
  check("当前页批量保存区域默认收起", Boolean(details) && !details.open);
}
click(tabButton(root, "设置"));
click(byButton("靠右悬浮"));
check("靠右位置立即生效并持久化", panel.parentElement.style.all()["justify-content"] === "flex-end" && script.store.panel_pos === "right");
click(tabButton(root, "当前页"));
click(tabButton(root, "设置"));
check("位置设置切 Tab 保留", byButton("靠右悬浮")._attrs["aria-pressed"] === "true");
click(byButton("屏幕居中"));
check("恢复居中并清理边距", panel.parentElement.style.all()["justify-content"] === "center" && panel.parentElement.style.all().padding === "0" && script.store.panel_pos === "center");
click(tabButton(root, "已保存"));
await settle();
const list = () => findAll(root, (e) => e.className === "wi-list-grid" || e.className === "wi-list-rows")[0];
check("默认双列网格", list().style.all().display === "grid" && list().style.all()["grid-template-columns"] === "repeat(2, minmax(0, 1fr))");
check("Grid 按钮激活态高亮且 List 为透明", byButton("Grid")._attrs["aria-pressed"] === "true" && byButton("List")._attrs["aria-pressed"] === "false" && byButton("Grid").style.all().background !== "transparent" && byButton("List").style.all().background === "transparent");
const batchBar = () => byButton("就这些聊")?.parentElement;
check("未勾选时批量操作栏自动隐藏", batchBar()?.style.all().display === "none");
let row = findAll(list(), (e) => e.className === "wi-card")[0];
click(row);
await settle();
check("卡片详情横跨双列", findAll(list(), (e) => e._detail)[0]?.style.all()["grid-column"] === "1 / -1");
const cb = findAll(row, (e) => e.type === "checkbox")[0];
cb.checked = true;
cb.fire("change");
check("勾选后批量操作栏自动浮现", batchBar()?.style.all().display === "flex");
click(byButton("List"));
check("切换紧凑列表并持久化", list().style.all().display === "flex" && script.store.saved_list_view_v1 === "list");
check("List 按钮激活态高亮且 Grid 为透明", byButton("List")._attrs["aria-pressed"] === "true" && byButton("Grid")._attrs["aria-pressed"] === "false" && byButton("List").style.all().background !== "transparent" && byButton("Grid").style.all().background === "transparent");
check("切视图保留选择", findAll(list(), (e) => e.type === "checkbox")[0].checked);
click(tabButton(root, "设置"));
click(tabButton(root, "已保存"));
await settle();
check("切 Tab 保留列表视图", list().style.all().display === "flex");
click(byButton("Grid"));
check("可恢复双列视图", list().style.all().display === "grid" && script.store.saved_list_view_v1 === "grid");
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
