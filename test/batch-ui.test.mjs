// 批量功能入口:只有 UP 主空间页出现「批量获取字幕」,三种页面都出现「批量保存网址」
// 运行:node test/batch-ui.test.mjs
import { runScript, findAll, tabButton, click, settle } from "./button-pos.domstub.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ""}`); }
};

function openPanel(href, title) {
  const { docEl: root } = runScript({
    innerWidth: 1280, innerHeight: 800,
    storeBox: { init: { worker: "https://w.dev", token: "t" } },
    href, title,
  });
  const btn = findAll(root, (e) => e.title === "Webbin 收集箱")[0];
  // 悬浮球在 pointerup 且无位移时打开面板(与线上一致)
  btn.fire("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  btn.fire("pointerup", { clientX: 0, clientY: 0, pointerId: 1 });
  return root;
}

const hasText = (root, txt) =>
  findAll(root, (e) => (e.textContent || "").includes(txt)).length > 0;

console.log("UP 主空间页");
{
  const root = openPanel("https://space.bilibili.com/123456", "某UP主的个人空间");
  check("出现 UP 主批量字幕入口", hasText(root, "批量获取视频字幕"));
  check("标明 mid", hasText(root, "UP主投稿批量字幕(mid: 123456)"));
  check("出现批量保存网址入口", hasText(root, "批量保存多个网址"));
  check("默认范围是最近 30 天", hasText(root, "最近 30 天"));
  check("空间页保留仅存链接", hasText(root, "仅存链接"));
}

console.log("UP 主空间子页面(投稿页)");
{
  const root = openPanel("https://space.bilibili.com/123456/upload/video", "投稿");
  check("投稿页同样出现批量字幕入口", hasText(root, "批量获取视频字幕"));
}

console.log("自定义日期状态");
{
  const root = openPanel("https://space.bilibili.com/123456", "空间");
  const dates = () => findAll(root, (e) => e.tagName === "INPUT" && e.type === "date");
  const sel = findAll(root, (e) => e.tagName === "SELECT")[0];
  sel.value = "custom";
  sel.fire("change");
  const [start, end] = dates();
  start.value = "2026-01-02";
  start.fire("change");
  end.value = "2026-02-03";
  end.fire("change");

  click(tabButton(root, "设置"));
  click(tabButton(root, "当前页"));
  const [start2, end2] = dates();
  check("自定义日期在 Tab 重建后保留",
    start2.value === "2026-01-02" && end2.value === "2026-02-03",
    `${start2.value} / ${end2.value}`);
}

console.log("普通 B 站视频页");
{
  const root = openPanel("https://www.bilibili.com/video/BV1xx411c7mD", "视频");
  check("保留单条保存字幕", hasText(root, "保存字幕"));
  check("出现批量保存网址入口", hasText(root, "批量保存多个网址"));
  check("不出现 UP 主批量入口", !hasText(root, "批量获取视频字幕"));
}

console.log("普通网页");
{
  const root = openPanel("https://example.com/article", "文章");
  check("保留单条保存", hasText(root, "保存到收集箱"));
  check("普通保存入口提供分组选择", hasText(root, "保存到分组"));
  check("出现批量保存网址入口", hasText(root, "批量保存多个网址"));
  check("不出现 UP 主批量入口", !hasText(root, "批量获取视频字幕"));
  click(tabButton(root, "已保存"));
  check("已保存页提供标题搜索", findAll(root, (e) => e.tagName === "INPUT" && e.placeholder === "搜索标题或网站").length === 1);
  check("已保存页提供分组筛选", findAll(root, (e) => e.tagName === "SELECT").some((e) => e.children.some((c) => c.textContent === "全部分组")));
  check("已保存页提供分组管理入口", hasText(root, "管理分组"));
}

await settle();
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
