# 交接单：批量收藏 / UP 主批量字幕（v0.9.0）

> 状态：**实现与本地测试已完成；第四轮本地复审已通过（2026-11-04），未 commit、未 push。**
> 仓库：`D:\Project\Tools\Webbin\webbin`（`D:\Project\Tools\Webbin` 不是 git 仓库）
> 本文件与已有的 `AGENT_CHAT_HANDOFF.md` 无关，后者是上一项对话功能的交接。

---

## 1. 任务需求

用户要求给 Webbin 油猴脚本增加两个功能：

1. **B 站 UP 主投稿批量字幕**
   - 仅在 UP 主空间页（`space.bilibili.com/<mid>`，含投稿子页）出现入口。
   - 可选择时间范围：最近 7 / 30 / 90 天、最近 1 年、自定义日期。
   - 只抓该范围内投稿视频的字幕，抓到的字幕直接写入现有收集箱（Worker API）。
   - 多 P 视频只抓第 1 P。

2. **批量保存多个网址**
   - 在「当前页」Tab 中提供可折叠的多行输入框。
   - 按现有规则逐条路由：
     - 普通网页 → 提取正文并保存；
     - B 站普通视频（BV/av）→ 抓字幕并保存；
     - `b23.tv` 短链 → 先解析再按目标类型处理；
     - B 站非视频页面 → 拒绝并提示；
   - 支持裸 BV/av 号、裸域名、一行多个网址、去重、单次上限。

3. **约束**
   - 现有四个面板 Tab 必须保持不变（`当前页 / 已保存 / 对话 / 设置`），`test/panel-tabs.test.mjs` 依赖恰好 4 个 tab 按钮。
   - **不要 push 到 GitHub。**
   - 完成前必须通过本地 reviewer；用户明确要求“处理完先不 push，先在本地通过 reviewer”。

---

## 2. 当前完成进度

已实现全部功能，工作区改动未提交：

```text
 M README.md
 M dev/preview.html
 M package.json
 M test/button-pos.domstub.mjs
 M userscript/webbin.user.js
?? test/batch-ui.test.mjs
?? test/batch.test.mjs
```

- 版本号：`0.9.0`（userscript 头、`GM_info` 兜底、`dev/preview.html` 已同步）。
- 最近一次完整测试：**168 passed, 0 failed**
  - routes 42 + chat-loop 14 + button-pos 25 + panel-tabs 8 + batch 66 + batch-ui 13。
- `node --check userscript/webbin.user.js`：通过。
- `git diff --check`：通过（仅 Git 的 CRLF 提示，无空白错误）。
- **没有** commit，**没有** push。

---

## 3. 已实现内容

### 3.1 UI

- `buildSaveTab()`：
  - 空间页：显示「B站 UP 主主页」+ `buildUpBatchSection(space)` + `buildBatchSaveSection()`。
  - 普通视频页：保留原有「保存字幕 / 保存评论 / 仅存链接」，下方追加批量保存。
  - 普通网页：保留原有提取/保存，下方追加批量保存。
- 「批量保存多个网址」为 `<details>`，展开状态持久化到 `batch_save_open`。
- 两个批量任务的状态都放在模块级 state 中，切 Tab / 面板重建后进度和结果不丢。
- 状态文案：
  - 预检时显示「正在检查 Worker 连接…」/「⏳ 检查连接…」；
  - 取消时显示「正在停止…(等待当前请求结束)」，停止按钮禁用并改文案；
  - 失败时状态行红色，toast 使用错误样式。
- 任务结果最多显示最近 100 条，内部最多保留 600 条。

### 3.2 UP 主投稿抓取

- 空间页识别：`getBiliSpacePage()` + `spaceMidFromPath()`。
- 投稿列表 API：`/x/space/wbi/arc/search`，`order=pubdate`，带 WBI 签名及 `dm_img_*`、`order_avoided` 等参数。
- 分页/边界：
  - `UP_PAGE_SIZE = 50`，`UP_MAX_PAGES = 40`（最多扫描约 2000 条投稿）。
  - 按发布时间倒序；遇到早于起始时间的内容停止翻页。
  - 第一页第一条若是旧置顶视频，只跳过这一条，不提前结束。
  - 按 `bvid` 去重，避免置顶视频重复。
  - 上限 `UP_BATCH_MAX = 300`。
- 抓字幕：`collectBiliSubtitle(bvid, page=1)` 复用单条字幕逻辑，标题格式为 `` `${baseTitle} · 字幕` ``。
- 并发 2，每条之间约 180ms；连续出现风控/登录/Worker 错误会自动停止。

### 3.3 批量保存网址

- 输入解析：
  - `normalizeBatchUrl()`：补协议、裸 BV/av 转链接、去包裹/句末标点、保留合法查询和 hash、拒绝带账号密码的 URL。
  - `parseBatchUrls()`：一行多个网址、裸域名、`#` 注释行、去重。
  - 全角标点只在其右侧“看起来像新网址起始”时作为分隔符，避免截断 `?q=你好，世界` 这类合法 IRI。
- 分类与路由：`classifyBatchUrl()` → `web | bili-video | bili-short | bili-other | invalid`。
- `resolveB23Url()`：用 `GM_xmlhttpRequest` 的 `finalUrl` / `responseURL` 解析短链。
- 网页正文：`fetchArticleFromUrl()`（`GM_xmlhttpRequest` + `DOMParser` + Readability，空结果走降级）。
- 去重：`dedupeTask()` 用 `Map<key, Promise>`，并发重复项等待首个结果；首个失败时允许重试，避免误跳过或重复保存。
- 并发 3，每条之间约 100ms；连续 Worker/Token 错误会停止；上限 `BATCH_SAVE_MAX = 500`。
- 开始前用 `ensureWorkerReady()` 调 `GET /api/settings` 预检 Worker/Token。

### 3.4 WBI 签名修复

- `buildWbiQuery()` 已改为正确顺序：

```js
w_rid = md5(query + mixinKey)
```

- 旧实现是 `md5(mixinKey + query)`，会触发 B 站 `-352` 风控。
- 已用 bilibili-API-collect 公开测试向量写入 `test/batch.test.mjs`，并用真实接口验证：
  - `query + key` → `code: 0`
  - `key + query` → `code: -352`

---

## 4. 关键文件 / 位置

| 文件 | 作用 |
| --- | --- |
| `userscript/webbin.user.js` | 主实现；批量 UI、WBI、投稿抓取、网址解析、去重、任务调度 |
| `test/batch.test.mjs` | 纯函数测试：WBI 向量、URL 解析/分类、日期范围、置顶过滤；**58 passed** |
| `test/batch-ui.test.mjs` | DOM 桩 UI 测试：三种页面入口可见性、自定义日期在 Tab 重建后保留；**12 passed** |
| `test/button-pos.domstub.mjs` | 扩展了 `href` / `title`、`URL` / `URLSearchParams` / `TextEncoder` / `TextDecoder` |
| `test/panel-tabs.test.mjs` | 必须保持 4 个 Tab，未改动 |
| `package.json` | test 脚本已追加 `batch.test.mjs` 和 `batch-ui.test.mjs` |
| `README.md` | 功能一览新增「批量收藏」 |
| `dev/preview.html` | 版本同步到 `0.9.0` |
| `index.js` | Worker 后端；本次**不需要改** |

主要函数位置（当前行号供参考）：

- `buildWbiQuery`：`userscript/webbin.user.js:489`
- 批量纯函数区：`552` 起（`normalizeBatchUrl:644`、`parseBatchUrls:663`、`rangePresetBounds:748`、`filterUpVideoPage:773`）
- `getBiliSpacePage`：`844`
- `collectBiliSubtitle`：`903`
- `ensureWorkerReady`：`1031`
- `fetchUpVideos`：`1094`
- `dedupeTask` / `saveBatchUrl`：`1145` / `1166`
- `runUpBatch`：`1570`
- `buildUpBatchSection`：`1676`
- `runBatchSave`：`1780`
- `buildBatchSaveSection`：`1868`

---

## 5. 复审历史与剩余事项

### 第一轮 reviewer

- 无 BLOCKER，报告了 3 个 MAJOR（URL 截断、Worker 预检、取消翻页）及若干 MINOR/NIT。已按建议修复。

### 第二轮 reviewer

- 无 BLOCKER / MAJOR；剩 5 组 MINOR + 1 NIT，主要是：
  - 全角标点边界；
  - `seenRefs` 失败清理/并发；
  - `checking` 状态与失败提示；
  - 停止反馈；
  - 裸域名 query/hash、FQDN 尾点；
  - `runPool` 非 Error reject。
- 已针对这些点继续修改。

### 第三轮 reviewer（最新）

- 结论：**1 MAJOR + 1 MINOR + 2 NIT**：
  - **MAJOR**：`parseBatchUrls` 曾对整行做全角标点全局替换，会截断 URL path/query 内的合法全角字符（如 `?q=你好，世界`、`路径（说明）`）。
  - **MINOR**：`seenRefs` 并发下，首个失败后已被跳过的重复项不会重试。
  - **NIT**：对象类型 reject 仍可能显示 `[object Object]`；confirm 取消后旧摘要残留。
- **上述问题均已在工作区修复**：
  - 删除全局替换，改为 `markSeps`：仅当分隔符右侧像新网址时才插入边界；`trimUrlEdges` 对全角右括号按成对计数处理；
  - `seenRefs` 改为 `Map<key, Promise>` + `dedupeTask()`，失败后可重新抢占；
  - `runPool` 提取对象上的 `message`；
  - 两个 start 函数在 checking 开始时清空 `summary/status/results`。
- 新增了对应 URL 测试（现 58 条），完整套件 159 条通过。
- ~~最后一步“第三轮复审确认”被中断（subagent 调用 aborted）~~ → 已补做。

### 第四轮 reviewer（最终，2026-11-04）

- 结论：**通过，可以本地验收。无 BLOCKER / MAJOR / MINOR，仅 4 个 NIT。**
- 第三轮全部修复已逐项核验（全角截断、seenRefs 重试、[object Object]、confirm 旧摘要），均带代码位置与探针实测证据。
- 本轮遗留 NIT（均不阻塞验收）：
  1. `looksLikeUrlStart` 固有歧义：URL 内全角分隔符后紧跟“裸域名样式文本”会被误拆（如 `?q=你好，b.com/x`）。可选改进：仅 scheme/`www.`/`b23.tv/` 开头才视为分隔。
  2. UP 主空间页不再提供单条「仅存链接」（被批量入口替代）——与任务规格一致，属产品取舍，如需保留可后续加回。
  3. `trimUrlEdges` 不剥 URL 尾部粘连的**开**括号/书名号（与已声明的“无空白散文粘连”同族）。
  4. `filterUpVideoPage` 只跳过第一页第一条旧置顶；B 站实际仅支持单条置顶，风险极低。
- 建议补测（非阻塞）：`fetchUpVideos` 翻页循环、`dedupeTask` 失败重试链、批量 UI start/cancel 状态机。

### NIT 修复（2026-11-04，复审通过后）

4 个 NIT 已全部修复，测试 168 条通过（batch 66 + batch-ui 13）：

1. **NIT-1（查询串守卫）**：`looksLikeUrlStart` 改为 `urlStartKind`（`scheme` / `host` 两类）。`markSeps` 中：分隔符左侧已在查询串/锚点内部（`?`/`#` 之后无空白，正则 `/[?#][^\s]*$/`）时，右侧的裸域名/BV/av/www/b23 样式视为参数内容不再切分；`scheme` 开头仍切分。保住了 `d.com/4，e.com/5`、`看这个，example.com`、`url1。BV1xx…` 的切分能力，挡住了 `?q=你好，b.com/x` 的静默误拆。已知取舍：左侧带查询时 `url1?x=2。b.com/2` 不再拆分（合并成一条，响亮失败优于静默错存）。
2. **NIT-2（空间页仅存链接）**：`buildSaveTab` 空间分支复用 `saveLink` 加回「仅存链接」按钮，batch-ui 增加断言。
3. **NIT-3（尾部开括号）**：`trimUrlEdges` 新增规则——开括号（ASCII `([{<` 与全角 `（【《「『`）出现在末尾必然失衡，直接剥掉。`https://a.com/1《https://b.com/2` 现可正确切成两条。
4. **NIT-4（多置顶）**：`filterUpVideoPage` 跳过第一页开头**所有**旧内容（`firstPage && !videos.length`），并用 `skippedLeadingOld` 保证"整页皆旧"仍判 `reachedOlder`，避免旧投稿账号被翻穿 40 页。
- 新增 8 条 batch 用例 + 1 条 batch-ui 用例；探针实测 13 个边界场景（含 scheme 列表、BV 列表、www 列表、b23 列表不回归）。

### 用户冒烟反馈处理（2026-11-04）

1. **「保存字幕」报"没有可用字幕"而批量可以**（如 `BV16B4K6REk5` 不行、`BV1hp4g6HEXz` 可以）：
   - 复查确认 `getView`/`saveBiliSubtitle` 新旧版本一字未改，批量完全复用同一函数；非回归。
   - 匿名探针（本机签名调 `player/wbi/v2`）证实：**未登录时两个视频的字幕列表都是 0 条**——能成功的视频靠登录 cookie 拿 AI 字幕；失败的视频连登录态下也无字幕（无 CC、B 站未生成 AI 字幕，"AI 早报"类 TTS 视频常见）。属数据差异，非代码问题。
   - 改进：`getWbiKey` 顺带记录 nav 的 `isLogin`（模块级 `biliLogin`），字幕为空的报错区分"未登录"与"确无字幕（部分视频不生成 AI 字幕）"。
2. **新功能：日期范围预计投稿数**。`fetchUpVideos` 增加 `maxPages` 参数；`runUpEstimate`/`scheduleUpEstimate`（防抖 600ms、代际号 `estGen` 作废旧统计、同范围结果缓存 `estCacheKey`）在空间页日期行下方显示"预计 N 个视频"；最多扫 `UP_EST_PAGES=6` 页（对齐单次上限 300）；正式任务开始时统计自动让位。README 已同步。

---

## 6. 建议下一步（交给下一个 agent）

1. **先跑基础验证**（PowerShell 下 `npm` 可能被执行策略拦截，必须用 `npm.cmd`）：

```powershell
cd D:\Project\Tools\Webbin\webbin
node --check userscript/webbin.user.js
npm.cmd test
git diff --check
git status --short
```

2. **继续本地 reviewer**，重点复核最新改动，不要只复述摘要：
   - `parseBatchUrls` / `markSeps` / `looksLikeUrlStart` / `trimUrlEdges`：
     - 全角逗号/句号/括号/引号出现在 URL 查询串、路径内部时不能被截断；
     - 一行多个网址（含裸域名、全角分隔符）仍能正确切分；
     - 句末标点、Markdown `)`、FQDN 尾点仍能清理。
   - `dedupeTask` / `saveBatchUrl`：
     - 同一视频/同一最终网页并发处理时只保存一次；
     - 首个失败后重复项可以重试；
     - 不产生未处理 Promise rejection。
   - `ensureWorkerReady` / `jobStatusText` / `paintUpBatch` / `paintBatchSave`：
     - `checking` → `running` 的时序；
     - 预检失败红色状态；
     - 停止按钮不会卡在“正在停止…”；
     - confirm 取消后不显示旧摘要。
   - 不要接受“测试全过”作为唯一证据，异步网络/UI 路径仍缺自动化覆盖。

3. **手动冒烟测试**（Tampermonkey + 真实 B 站账号）：
   - `space.bilibili.com/<mid>`：时间范围切换、自定义日期、跨 Tab 后日期保留；
   - 抓取投稿列表，确认置顶视频不会导致提前停止；
   - 中途点停止，确认状态很快变为已停止；
   - 批量粘贴：普通网页 + B 站视频 + b23 短链 + 重复链接 + 裸 BV；
   - Worker 地址/Token 填错时，确认预检直接失败而不是抓完才失败；
   - AI 字幕需要浏览器已登录 B 站。

4. **仅在 reviewer 明确通过后**再考虑 commit；**push 必须等用户再次明确授权**。当前不要 commit / push。

---

## 7. 已知限制 / 风险

- **全角分隔符启发式**：只有分隔符右侧像网址起始时才切分。若网址后紧跟没有空白的散文（如 `https://a.com/x。真的不错`），后半段可能被编码进 URL。这是为了避免截断合法 IRI 的保守取舍；如要改进，需要更精细的 URL 边界解析。
- **异步路径缺自动化测试**：`ensureWorkerReady`、`saveBatchUrl` / `dedupeTask` 的并发、`runUpBatch` 取消、UI checking/停止状态目前主要靠 reviewer 代码核对和手动测试。
- **B 站接口风险**：`/x/space/wbi/arc/search` 可能受风控、登录状态、WBI 参数变化影响；真实接口已验证一次 `code:0`，但不保证长期稳定。
- **多 P 视频只抓第 1 P**；UP 批量上限 300；列表最多扫 40 页；批量保存上限 500。
- **`collectBiliSubtitle` 标题格式**：`` `${baseTitle} · 字幕` ``，与单条保存保持一致。
- 仓库根目录的 `AGENT_CHAT_HANDOFF.md` 是上一项功能的交接，不要覆盖。

---

## 8. 一句话交接

功能代码、WBI 修复、UI 与测试都已完成且 168 条测试通过；第四轮本地复审通过（无 BLOCKER/MAJOR/MINOR），其提出的 4 个 NIT 也已全部修复。工作区未提交、未推送。剩余：用户手动冒烟测试（Tampermonkey + 真实账号），以及 commit / push 均需用户明确授权。
