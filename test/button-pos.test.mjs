// 悬浮球"记忆位置"越界导致按钮消失的回归测试(v0.8.16 修复)
// 运行:node test/button-pos.test.mjs
import { runScript, visible } from "./button-pos.domstub.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ""}`); }
};

function load({ innerWidth, innerHeight, store = {}, faithfulStore = false, sameBox, dropDeleteApi = false }) {
  const box = sameBox || { init: store };
  const r = runScript({ innerWidth, innerHeight, storeBox: box, faithfulStore, dropDeleteApi });
  r.fire = (w, h) => { r.view.w = w; r.view.h = h; r.resizeFns.forEach((f) => f({ type: "resize" })); };
  return r;
}

const OPEN = "打开收集箱", RESET = "重置悬浮球位置";
const menu = (r, name) => r.menus.find(([n]) => n === name)?.[1];

console.log("悬浮球位置记忆/复位");
{
  const r = load({ innerWidth: 1280, innerHeight: 800 });
  check("无存储坐标时按钮被创建且在视口内", !!r.btn && visible(r.btn, 1280, 800), JSON.stringify(r.btn?._props));
  check("默认走 right/bottom 锚点", r.btn?._props.right === "16px" && r.btn?._props.bottom === "96px");
}
{
  const r = load({ innerWidth: 1280, innerHeight: 800, store: { btnX: 300, btnY: 200 } });
  check("视口内的记忆位置原样恢复", r.btn?.offsetLeft === 300 && r.btn?.offsetTop === 200,
    `${r.btn?.offsetLeft},${r.btn?.offsetTop}`);
}
{
  // 核心回归:1920x1200 下拖到右下角,之后换 1000x700 视口加载
  const r = load({ innerWidth: 1000, innerHeight: 700, store: { btnX: 1600, btnY: 1000 } });
  check("越界坐标被钳制进视口(按钮不再消失)", visible(r.btn, 1000, 700), JSON.stringify(r.btn?._props));
  check("钳到右下边界 954/654", r.btn?.offsetLeft === 954 && r.btn?.offsetTop === 654,
    `${r.btn?.offsetLeft},${r.btn?.offsetTop}`);
  check("钳制不回写存储(窗口变大仍能回原位)", r.store.btnX === 1600 && r.store.btnY === 1000, JSON.stringify(r.store));
}
{
  const r = load({ innerWidth: 1000, innerHeight: 700, store: { btnX: 100, btnY: 5000 } });
  check("两轴独立钳制:未越界的 X 保持不变", r.btn?.offsetLeft === 100, String(r.btn?.offsetLeft));
  check("越界的 Y 钳到 654", r.btn?.offsetTop === 654, String(r.btn?.offsetTop));
}
{
  const r = load({ innerWidth: 1920, innerHeight: 1080, store: { btnX: 1800, btnY: 1000 } });
  r.fire(800, 600);
  check("页面打开期间视口收缩后被自动拉回(无需刷新)", visible(r.btn, 800, 600), JSON.stringify(r.btn?._props));
  r.fire(1920, 1080);
  check("窗口恢复后可回到原位置", r.btn?.offsetLeft === 1800 && r.btn?.offsetTop === 1000,
    `${r.btn?.offsetLeft},${r.btn?.offsetTop}`);
}
{
  const r = load({ innerWidth: 30, innerHeight: 30, store: { btnX: 900, btnY: 900 }, isMobile: true });
  check("极小视口不产生负坐标", r.btn?.offsetLeft === 0 && r.btn?.offsetTop === 0,
    `${r.btn?.offsetLeft},${r.btn?.offsetTop}`);
  check("钳制使用 BTN_SIZE(移动端 38)", r.btn?.offsetWidth === 38, String(r.btn?.offsetWidth));
}
{
  const r = load({ innerWidth: 1000, innerHeight: 700 });
  const b = r.btn;
  b.dispatch("pointerdown", { clientX: 900, clientY: 600, pointerId: 1 });
  b.dispatch("pointermove", { clientX: 99999, clientY: 99999, pointerId: 1 });
  check("拖动仍被钳制在视口内", b.offsetLeft === 954 && b.offsetTop === 654, `${b.offsetLeft},${b.offsetTop}`);
  b.dispatch("pointerup", { pointerId: 1 });
  check("落盘坐标在界内", r.store.btnX === 954 && r.store.btnY === 654, JSON.stringify(r.store));
}
{
  const box = { init: { btnX: 1600, btnY: 1000 } };
  const r = load({ innerWidth: 1000, innerHeight: 700, sameBox: box });
  check("菜单已注册重置命令", typeof menu(r, RESET) === "function", JSON.stringify(r.menus.map((m) => m[0])));
  check("菜单仍保留打开收集箱", typeof menu(r, OPEN) === "function");
  menu(r, RESET)();
  check("重置真删存储键(不是写 null)", !("btnX" in r.raw) && !("btnY" in r.raw), JSON.stringify(r.store));
  check("重置后立刻回到默认定位",
    r.btn?._props.right === "16px" && r.btn?._props.bottom === "96px" && r.btn?._props.left === undefined,
    JSON.stringify(r.btn?._props));
  const again = load({ innerWidth: 1000, innerHeight: 700, sameBox: box });
  check("重置后重新加载走默认分支", again.btn?._props.right === "16px" && again.btn?.offsetLeft === 938,
    `right=${again.btn?._props.right} left=${again.btn?.offsetLeft}`);
}
{
  // 未授予 GM_deleteValue 的管理器:降级为写 null,必须同样能复位
  const box = { init: { btnX: 1600, btnY: 1000 } };
  const r = load({ innerWidth: 1000, innerHeight: 700, sameBox: box, dropDeleteApi: true });
  menu(r, RESET)();
  check("未授予 GM_deleteValue 时降级写 null", r.raw.btnX === null && r.raw.btnY === null, JSON.stringify(r.store));
  const again = load({ innerWidth: 1000, innerHeight: 700, sameBox: box, dropDeleteApi: true });
  check("降级路径下重新加载走默认分支", again.btn?._props.right === "16px", String(again.btn?._props.right));
}
{
  // 脏值:字符串"null"/越界数不得让球落到 NaN 或视口外
  const r = load({ innerWidth: 1000, innerHeight: 700, store: { btnX: "null", btnY: "1000" } });
  check("脏值不产生 NaN 定位", !String(r.btn?._props.left).includes("NaN"), JSON.stringify(r.btn?._props));
  check("脏值下按钮仍在视口内", visible(r.btn, 1000, 700), JSON.stringify(r.btn?._props));
}
{
  // 坏存储管理器:写入的值被序列化成字符串
  const r = load({ innerWidth: 1000, innerHeight: 700, store: { btnX: 1600, btnY: 1000 }, faithfulStore: true });
  check("字符串坐标未被当成长度拼接", r.btn?.offsetLeft === 954, String(r.btn?.offsetLeft));
}
{
  const r = load({ innerWidth: 1280, innerHeight: 800 });
  const b = r.btn;
  b.dispatch("pointerdown", { clientX: 1240, clientY: 680, pointerId: 1 });
  b.dispatch("pointermove", { clientX: 1241, clientY: 681, pointerId: 1 });
  // 未拖动即点击 → 打开面板;桩不含完整面板,渲染异常与定位逻辑无关,隔离后只断言"未写坐标"
  try { b.dispatch("pointerup", { pointerId: 1 }); } catch { /* 面板渲染不在本测试范围 */ }
  check("未拖动不写坐标(点击路径未被破坏)", !("btnX" in r.raw) && !("btnY" in r.raw), JSON.stringify(r.store));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
