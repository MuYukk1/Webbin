// 面板标签切换后的滚动容器状态回归测试
// 复现并守住:已保存 → 对话 → 已保存 之后,列表必须仍能用滚轮滚动
import { runScript, findAll, panelOf, tabButton, scrollBodyOf, click, settle } from "./button-pos.domstub.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ""}`); }
};

const { docEl: root } = runScript({
  innerWidth: 1280, innerHeight: 800,
  storeBox: { init: { worker: "https://w.dev", token: "t" } },
});

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
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
