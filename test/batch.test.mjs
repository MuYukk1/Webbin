// 批量保存 / UP主时间范围纯函数测试
// 运行:node test/batch.test.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../userscript/webbin.user.js", import.meta.url), "utf8");
const blocks = [...src.matchAll(/\/\* WI-PURE-BEGIN[\s\S]*?\/\* WI-PURE-END \*\//g)]
  .map((m) => m[0].replace(/\/\* WI-PURE-BEGIN[\s\S]*?\*\//, "").replace(/\/\* WI-PURE-END \*\//, ""));
if (blocks.length < 2) throw new Error("userscript 里找不到批量相关 WI-PURE 纯函数区");
const pure = new Function(
  blocks.join("\n") +
  "; return { md5, buildWbiQuery, parseBiliVideoRef, spaceMidFromPath, normalizeBatchUrl, parseBatchUrls, classifyBatchUrl, dateToInput, dateInputToMs, rangePresetBounds, videoInRange, filterUpVideoPage };",
)();

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ""}`); }
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}`);

console.log("WBI 签名");
{
  // 公开测试向量:bilibili-API-collect/docs/misc/sign/wbi.md
  eq("md5", pure.md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  eq("公开测试向量",
    pure.buildWbiQuery("ea1db124af3c7062474693fa704f4ff8",
      { foo: "114", bar: "514", zab: 1919810 }, 1702204169),
    "bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4");
}

console.log("B站视频链接解析");
{
  eq("BV + 分P",
    pure.parseBiliVideoRef("https://www.bilibili.com/video/BV1xx411c7mD?p=3"),
    { bvid: "BV1xx411c7mD", page: 3 });
  eq("裸 BV 号", pure.parseBiliVideoRef("BV1xx411c7mD"), { bvid: "BV1xx411c7mD", page: 1 });
  eq("av 号", pure.parseBiliVideoRef("av170001"), { bvid: "av170001", page: 1 });
  eq("m 站 av 链接",
    pure.parseBiliVideoRef("https://m.bilibili.com/video/av170001?p=2"),
    { bvid: "av170001", page: 2 });
  eq("空间页不是普通视频", pure.parseBiliVideoRef("https://space.bilibili.com/2"), null);
  eq("b23 纯短码待解析", pure.parseBiliVideoRef("https://b23.tv/abc"), null);
  eq("b23 直带 BV", pure.parseBiliVideoRef("https://b23.tv/BV1xx411c7mD"), { bvid: "BV1xx411c7mD", page: 1 });
}

console.log("空间页 mid / 网址归一化");
{
  eq("mid 主页", pure.spaceMidFromPath("/123456"), "123456");
  eq("mid 投稿页", pure.spaceMidFromPath("/123456/upload/video"), "123456");
  eq("非 mid 路径", pure.spaceMidFromPath("/video/BV1xx411c7mD"), "");
  eq("补协议", pure.normalizeBatchUrl("example.com/a"), "https://example.com/a");
  eq("裸域名带查询串", pure.normalizeBatchUrl("example.com?q=a,b"), "https://example.com/?q=a,b");
  eq("裸域名带锚点", pure.normalizeBatchUrl("example.com#part"), "https://example.com/#part");
  eq("去域名末尾句点", pure.normalizeBatchUrl("example.com."), "https://example.com/");
  eq("去域名末尾句点(带查询)", pure.normalizeBatchUrl("example.com.?q=1"), "https://example.com/?q=1");
  eq("保留 hash", pure.normalizeBatchUrl("https://example.com/a#part"), "https://example.com/a#part");
  eq("裸 BV 转链接", pure.normalizeBatchUrl("BV1xx411c7mD"), "https://www.bilibili.com/video/BV1xx411c7mD");
  eq("裸 av 转链接", pure.normalizeBatchUrl("av170001"), "https://www.bilibili.com/video/av170001");
  eq("b23 补协议", pure.normalizeBatchUrl("b23.tv/abc"), "https://b23.tv/abc");
  eq("说明文字不误判", pure.normalizeBatchUrl("不是网址"), "");
  eq("合法括号结尾不被截断",
    pure.normalizeBatchUrl("https://en.wikipedia.org/wiki/Mercury_(planet)"),
    "https://en.wikipedia.org/wiki/Mercury_(planet)");
  eq("去掉句末多余右括号",
    pure.normalizeBatchUrl("https://example.com/a)"),
    "https://example.com/a");
  eq("保留合法感叹号",
    pure.normalizeBatchUrl("https://example.com/foo!"),
    "https://example.com/foo!");
  eq("保留查询里的逗号",
    pure.normalizeBatchUrl("https://example.com/?q=a,b"),
    "https://example.com/?q=a,b");
  eq("拒绝带账号密码的网址",
    pure.normalizeBatchUrl("https://user:pass@example.com/"), "");
  eq("去全角右括号",
    pure.normalizeBatchUrl("https://example.com/a）"),
    "https://example.com/a");
  eq("路径内成对全角括号保留",
    pure.normalizeBatchUrl("https://example.com/路径（说明）"),
    "https://example.com/%E8%B7%AF%E5%BE%84%EF%BC%88%E8%AF%B4%E6%98%8E%EF%BC%89");
  eq("去 Markdown 链接后的句号",
    pure.normalizeBatchUrl("https://example.com/a)."),
    "https://example.com/a");
  eq("带括号的合法 URL 后接句号不被截断",
    pure.normalizeBatchUrl("https://en.wikipedia.org/wiki/Mercury_(planet)."),
    "https://en.wikipedia.org/wiki/Mercury_(planet)");
  eq("去尾部开全角括号(必然失衡)",
    pure.normalizeBatchUrl("https://example.com/a（"),
    "https://example.com/a");
  eq("去尾部开书名号",
    pure.normalizeBatchUrl("https://example.com/a《"),
    "https://example.com/a");
}

console.log("批量输入解析 / 分类");
{
  const urls = pure.parseBatchUrls([
    "https://a.com/1",
    "https://a.com/1",
    "https://b.com/2, https://c.com/3",
    "BV1xx411c7mD",
    "# 注释行",
    "无效文本",
    "d.com/4, e.com/5",
  ].join("\n"));
  eq("去重 + 多网址同行 + 裸 BV + 裸域名", urls, [
    "https://a.com/1",
    "https://b.com/2",
    "https://c.com/3",
    "https://www.bilibili.com/video/BV1xx411c7mD",
    "https://d.com/4",
    "https://e.com/5",
  ]);
  eq("普通视频", pure.classifyBatchUrl("https://www.bilibili.com/video/BV1xx411c7mD"), "bili-video");
  eq("B站短链", pure.classifyBatchUrl("https://b23.tv/abc"), "bili-short");
  eq("B站其他页面", pure.classifyBatchUrl("https://space.bilibili.com/2"), "bili-other");
  eq("普通网页", pure.classifyBatchUrl("https://example.com/a"), "web");
  eq("非法输入", pure.classifyBatchUrl(""), "invalid");

  const zh = pure.parseBatchUrls("（https://a.com/1）https://b.com/2，https://c.com/3。");
  eq("全角括号/逗号/句号作为分隔符", zh, [
    "https://a.com/1",
    "https://b.com/2",
    "https://c.com/3",
  ]);
  eq("裸域名之间用全角逗号分隔", pure.parseBatchUrls("d.com/4，e.com/5"), [
    "https://d.com/4",
    "https://e.com/5",
  ]);
  eq("查询串内的全角逗号不被截断",
    pure.parseBatchUrls("https://example.com/search?q=你好，世界"),
    ["https://example.com/search?q=%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C"]);
  eq("路径内的全角逗号不被截断",
    pure.parseBatchUrls("https://example.com/a，b"),
    ["https://example.com/a%EF%BC%8Cb"]);
  eq("路径内成对全角括号不被截断",
    pure.parseBatchUrls("https://example.com/路径（说明）"),
    ["https://example.com/%E8%B7%AF%E5%BE%84%EF%BC%88%E8%AF%B4%E6%98%8E%EF%BC%89"]);
  eq("查询串内全角分隔后跟裸域名不切分",
    pure.parseBatchUrls("https://example.com/search?q=你好，b.com/x"),
    ["https://example.com/search?q=%E4%BD%A0%E5%A5%BD%EF%BC%8Cb.com/x"]);
  eq("锚点内全角分隔后跟裸域名不切分",
    pure.parseBatchUrls("https://example.com/page#锚点，b.com/x"),
    ["https://example.com/page#%E9%94%9A%E7%82%B9%EF%BC%8Cb.com/x"]);
  eq("查询串后跟 scheme 开头网址仍切分",
    pure.parseBatchUrls("https://a.com/?url=x，https://b.com/2"),
    ["https://a.com/?url=x", "https://b.com/2"]);
  eq("全角开书名号后跟新网址可切分且开书名号被剥",
    pure.parseBatchUrls("https://a.com/1《https://b.com/2"),
    ["https://a.com/1", "https://b.com/2"]);
}

console.log("时间范围");
{
  const now = new Date(2026, 10, 3, 12, 30).getTime(); // 2026-11-03 本地时间
  eq("date input 格式", pure.dateToInput(now), "2026-11-03");
  eq("日期起点", pure.dateInputToMs("2026-11-03", false), new Date(2026, 10, 3).getTime());
  eq("日期终点含整天", pure.dateInputToMs("2026-11-03", true), new Date(2026, 10, 3, 23, 59, 59, 999).getTime());
  eq("非法日期", pure.dateInputToMs("2026-02-30", false), null);

  const d7 = pure.rangePresetBounds("7d", now);
  eq("最近 7 天起止", [d7.start, d7.end], ["2026-10-28", "2026-11-03"]);
  const d30 = pure.rangePresetBounds("30d", now);
  eq("最近 30 天起点", d30.start, "2026-10-05");
  const d1y = pure.rangePresetBounds("1y", now);
  eq("最近 1 年起点", d1y.start, "2025-11-03");
  const custom = pure.rangePresetBounds("custom", now, "2026-10-01", "2026-10-31");
  eq("自定义范围", [custom.start, custom.end], ["2026-10-01", "2026-10-31"]);
  eq("自定义反向日期", pure.rangePresetBounds("custom", now, "2026-10-31", "2026-10-01"), null);
  eq("未知预设", pure.rangePresetBounds("nope", now), null);
  eq("投稿时间在范围内", pure.videoInRange(new Date(2026, 9, 15).getTime() / 1000, d30.startMs, d30.endMs), true);
  eq("投稿时间早于范围", pure.videoInRange(new Date(2026, 8, 1).getTime() / 1000, d30.startMs, d30.endMs), false);

  const at = (y, m, d) => new Date(y, m - 1, d).getTime() / 1000;
  const page = [
    { bvid: "pinned", created: at(2026, 9, 1) },
    { bvid: "new", created: at(2026, 10, 20) },
    { bvid: "mid", created: at(2026, 10, 10) },
    { bvid: "old", created: at(2026, 9, 20) },
  ];
  const filtered = pure.filterUpVideoPage(page, d30, true);
  eq("第一页跳过旧置顶并保留范围内视频", filtered.videos.map((v) => v.bvid), ["new", "mid"]);
  eq("遇到更早内容后停止", filtered.reachedOlder, true);
  eq("非第一页不跳过旧首条", pure.filterUpVideoPage(page, d30, false).reachedOlder, true);
  eq("晚于结束时间的视频被跳过",
    pure.filterUpVideoPage([{ bvid: "future", created: at(2026, 11, 10) }, page[1]], d30, true)
      .videos.map((v) => v.bvid),
    ["new"]);
  const page2 = [
    { bvid: "pin1", created: at(2026, 9, 1) },
    { bvid: "pin2", created: at(2026, 9, 5) },
    { bvid: "new2", created: at(2026, 10, 20) },
  ];
  eq("多条旧置顶都被跳过",
    pure.filterUpVideoPage(page2, d30, true).videos.map((v) => v.bvid), ["new2"]);
  eq("整页皆旧仍判到达更早",
    pure.filterUpVideoPage(
      [{ bvid: "o1", created: at(2026, 9, 1) }, { bvid: "o2", created: at(2026, 9, 2) }], d30, true,
    ).reachedOlder,
    true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
