# Webbin UI 重构设计稿与执行交接单（StashDock 柔和极简风格）

> **交接对象**：Astra（执行 Agent）  
> **目标仓库**：`D:\Project\Tools\Webbin\webbin`  
> **涉及文件**：`userscript/webbin.user.js`、`dev/preview.html`（及必要的 UI 回归测试补充）  
> **后端约束**：`index.js`（Worker 后端）**无需改动**  
> **交互原型参考**：`dev/stashdock-demo.html`（同仓库内可直接打开查看视觉、DOM 结构与动效参数）

---

## 1. 用户已确认的核心设计决策

1. **视觉风格（StashDock Soft Minimalism / Tactile Pill UI）**
   - 采用**三层微差表面（画布底色 < 浅灰凹槽轨 < 纯白浮起胶囊/内槽）** + **全胶囊控件（`border-radius: 9999px`）** + **同心双层圆角 Bento 卡片**。
   - 图标体系淘汰零散 Emoji，改用 CSP 安全的单色圆头线性 SVG 图标（Lucide 风格，`stroke-width: 1.85`）。
2. **无预览图极速方案（Zero-Thumbnail Typography Well）**
   - **不加载、不抓取任何网页截图或视频封面图**（零额外网络开销）。
   - 双列卡片上半部的同心内嵌圆角槽（Well）用于展示：**左上角圆形悬浮勾选框 + 右上角状态胶囊（`✨ 已总结` / `📺 B站` / `✅ 已归档`）+ 站点/时间/分组紧凑元数据摘录**。
3. **主题策略：自动跟随系统深浅色**
   - 沿用 `matchMedia("(prefers-color-scheme: dark)").matches`，不单独强制锁定主题；将 `C`（`userscript/webbin.user.js:121-140`）升级为暖白（Light）/ 暖炭黑（Dark）分层表面调色板。
4. **面板尺寸：紧凑固定尺寸 `540px × 640px`**
   - 面板宽高由原来的 `min(94vw, 500px) × min(86vh, 720px)` 调整为：
     - `width: min(94vw, 540px)`
     - `height: min(84vh, 640px)`
   - 卡片采用紧凑内边距（单卡总高约 `128px~142px`），在 `540px` 面板内恰好舒适排下双列（`grid-template-columns: repeat(2, minmax(0, 1fr))`），整体窗口面积比旧版更精巧、不压迫网页视野。
5. **面板弹出位置：新增用户设置项（屏幕居中 vs 靠右侧悬浮）**
   - 存储键：`panel_pos`（通过 `GM_getValue("panel_pos", "center")` 读取，默认 `"center"`）。
   - 可选值：
     - `"center"`（默认，屏幕正中间弹出）：遮罩层 `justify-content: center; align-items: center;`，遮罩底色略微调轻（浅色下 `rgba(15, 16, 18, 0.24)` + `blur(3px)`）以降低压迫感。
     - `"right"`（靠右侧悬浮抽屉）：遮罩层 `justify-content: flex-end; align-items: center; padding-right: 16px;`，不挡宿主页正中央的视频或正文。
   - 在「设置」Tab 顶部新增「界面与弹出位置」卡片，提供 `屏幕居中 | 靠右悬浮` 胶囊分段切换，点击后立即更新当前 `panelEl` 布局并持久化到 `GM_setValue("panel_pos", val)`。

---

## 2. 不可破坏的测试兼容硬约束（198 Passed 守则）

当前仓库共有 7 个测试文件（共 198 项断言），其中 5 个通过 Node `vm` + 自定义轻量 DOM 桩（`test/button-pos.domstub.mjs` 和 `test/chat-loop.test.mjs`）直接驱动 `userscript/webbin.user.js`。**重构 UI 时必须严格遵守以下 DOM 拓扑与文案契约：**

### 2.1 DOM 桩能力边界
- 测试桩 `El` **不支持** `ShadowRoot`（`attachShadow`）、**不支持** `innerHTML` 解析查询、且 `querySelectorAll` 返回空数组 `[]`。
- 因此：
  1. 继续挂载在 Light DOM（`document.documentElement.append(...)`），使用 `[data-wi-ui]` 属性 + `GM_addStyle` 注入作用域 CSS。
  2. 若使用 `document.createElementNS` 创建 SVG 图标，需写法防御：
     ```js
     const createSvgEl = (tag) =>
       typeof document.createElementNS === "function"
         ? document.createElementNS("http://www.w3.org/2000/svg", tag)
         : document.createElement(tag);
     ```
     这样无需改任何旧测试桩即可在 Node `vm` 中零报错运行。
  3. **禁止在按钮内把图标作成带文字的节点污染 `button.textContent`**：测试中大量使用 `byText(root, "保存到收集箱", "BUTTON")` 或 `b.textContent.trim() === "已保存"`（`El.textContent` 会拼接所有子节点的 `textContent`）。
     - **最佳实践**：SVG 图标内部只包含 `<path>` / `<circle>` / `<rect>` / `<line>` / `<polyline>` 等无文本几何标签（`textContent` 为 `""`），切勿使用 `<text>` 或字符图标拼进关键按钮内部！

### 2.2 面板顶层 DOM 拓扑契约（`test/button-pos.domstub.mjs:192-204` & `test/panel-tabs.test.mjs`）
测试通过以下函数定位面板与滚动区：
```js
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
```
**硬约束**：
1. `panel` 的直接子元素顺序**必须**保持：
   - `panel.children[0]` = `tabs`（必须是 `DIV`，且 `tabs.children` **恰好只有 4 个 `BUTTON`**，文案依次为 `"当前页"`、`"已保存"`、`"对话"`、`"设置"`）。
   - `panel.children[1]` = `body`（滚动容器）。
   - `panel.children[2]` = `footer`（底部版本与状态栏）。
2. 如何将 `tabs` 渲染为 StashDock 顶栏胶囊分段器？
   - 直接把 `tabs`（`panel.children[0]`）设置外边距 `margin: 12px 14px 4px`、内边距 `padding: 4px`、背景 `C.bg2`、圆角 `border-radius: 9999px`、边框 `1px solid ${C.border}`！
   - 里面的 4 个 `button` 设置 `border-radius: 9999px`；选中态 `background: C.surface`、`color: C.text`、`font-weight: 600`、`box-shadow: C.pillShadow`；未选中态 `background: transparent`、`color: C.sub`。这样既 100% 满足 `panel.children[0]` 的拓扑契约，又完美呈现 StashDock 顶栏胶囊滑槽！
3. `switchTab(key)` 中对 `body.style` 的设置必须保留（`test/panel-tabs.test.mjs:30-58` 逐项断言）：
   - `key === "list"`：`padding: "0 14px 14px"`, `overflow: "auto"`, `overflow-y: "auto"`
   - `key === "chat"`：`padding: "0"`, `overflow: "hidden"`, `overflow-y: "hidden"`
   - `key === "save"` / `"settings"`：`padding: "14px"`, `overflow: "auto"`, `overflow-y: "auto"`
   - 滚动条样式 `<style id="webbin-scrollbar-style">` 保持唯一 ID 不变。

### 2.3 各 Tab 必须保留的文案与表单控件契约
| 测试文件 | 必须保留的控件 / 精确文案 |
| :--- | :--- |
| `test/button-pos.test.mjs` | 悬浮球 `title="Webbin 收集箱"`、`data-wi-ui="1"`、尺寸常量 `BTN_SIZE`（桌面 46 / 移动 38）、默认 `right: 16px; bottom: 96px`、菜单命令 `"打开收集箱"` 与 `"重置悬浮球位置"` |
| `test/saved-state.test.mjs` | ① 「当前页」Tab 内必须恰好有 2 个 `<select>`（单条保存分组选择器 + 批量保存分组选择器），且无其他 `<select>` 干扰 `findAll(body(), e => e.tagName === "SELECT")`<br>② 「已保存」Tab 的分组筛选器第一个 `<select>` 必须保持 `groupFilter.value` 与 `saved_list_group_v1` 同步<br>③ 按钮精确文案：`"保存到收集箱"`、`"保存连接信息"`、`"刷新"`<br>④ 设置页 Worker 输入框 `placeholder === "https://webbin.xxx.workers.dev"`<br>⑤ 列表缓存状态文案包含：`"已显示本地缓存"`、`"刷新失败,当前显示本地缓存"`、`"已更新"` |
| `test/batch-ui.test.mjs` | ① 空间页包含文案：`"批量获取视频字幕"`、`"UP主投稿批量字幕(mid: 123456)"`、`"批量保存多个网址"`、`"最近 30 天"`、`"仅存链接"`<br>② 空间页保留时间预设 `<select>`（第一个 `SELECT`）及 2 个 `<input type="date">`<br>③ 视频页包含文案：`"保存字幕"`、`"批量保存多个网址"`<br>④ 普通网页包含文案：`"保存到收集箱"`、`"保存到分组"`、`"批量保存多个网址"`<br>⑤ 「已保存」页包含：`<input placeholder="搜索标题或网站">`、含 `"全部分组"` `<option>` 的 `<select>`、含 `"管理分组"` 文案 |
| `test/chat-loop.test.mjs` | ① 对话消息滚动容器 `msgs` 必须保留 `padding: "6px 2px"`（测试用 `e.tagName === "DIV" && e.style.padding === "6px 2px"` 定位 `msgsElOf`）<br>② 发送按钮空闲时 `textContent.trim() === "➤"`，运行中为 `"■"`<br>③ 工具状态与卡片详情保留 `"📄 读取"` 与 `"已截断"` 文案<br>④ `overlay` 保持挂在 `document.documentElement` 下且绑定 `click` 监听器 |

---

## 3. 设计系统规范（Design Tokens & CSS）

### 3.1 升级后的 `C` 调色板（`userscript/webbin.user.js:121-140`）

```js
  const DARK = matchMedia("(prefers-color-scheme: dark)").matches;
  // StashDock 柔和极简三层表面:
  // bg(面板画布底) < bg2(凹槽轨/卡片外框/输入槽) < surface(纯白浮起胶囊/卡片内槽) < bg3(悬浮加深)
  const C = {
    bg: DARK ? "#16171b" : "#fbfbfa",
    bg2: DARK ? "#202228" : "#efefec",
    bg3: DARK ? "#282b33" : "#e6e6e2",
    surface: DARK ? "#262932" : "#ffffff",
    card: DARK ? "#1c1e24" : "#f3f3f0",
    cardHover: DARK ? "#22252d" : "#ecece8",
    text: DARK ? "#f3f4f6" : "#18181b",
    sub: DARK ? "#9ca3af" : "#68686f",
    muted: DARK ? "#6b7280" : "#94949c",
    accent: DARK ? "#5b8def" : "#3b6ff5",      // 品牌高亮色(焦点环/链接/主要状态)
    primaryBg: DARK ? "#f3f4f6" : "#18181b",   // StashDock 深炭黑/亮白主胶囊底色
    primaryFg: DARK ? "#111215" : "#ffffff",   // 主胶囊文字色
    border: DARK ? "rgba(255,255,255,0.08)" : "rgba(24,24,27,0.08)",
    borderStrong: DARK ? "rgba(255,255,255,0.15)" : "rgba(24,24,27,0.14)",
    danger: DARK ? "#f2555a" : "#e5484d",
    ok: DARK ? "#3dd68c" : "#299764",
    pillShadow: DARK
      ? "0 2px 6px rgba(0,0,0,0.38), 0 1px 2px rgba(0,0,0,0.24)"
      : "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
    cardShadow: DARK
      ? "0 2px 8px rgba(0,0,0,0.24)"
      : "0 2px 6px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02)",
    cardShadowHover: DARK
      ? "0 10px 24px rgba(0,0,0,0.4), 0 4px 10px rgba(0,0,0,0.24)"
      : "0 8px 20px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)",
    panelShadow: DARK
      ? "0 24px 64px rgba(0,0,0,0.58), 0 4px 16px rgba(0,0,0,0.35)"
      : "0 20px 52px rgba(0,0,0,0.14), 0 4px 14px rgba(0,0,0,0.05)",
  };
```
> **注意**：`rgbaOf(hex, a)` 仅对 `#rrggbb` 格式调用（如 `C.accent`、`C.bg`、`C.surface`），不要对已经是 `rgba(...)` 的 `C.border` 调用 `rgbaOf`。

### 3.2 圆角比例与同心圆角规范
- **面板外框（Panel）**：`border-radius: 22px`
- **双层 Bento 卡片外框（Outer Card）**：`border-radius: 18px`，`padding: 8px`
- **双层卡片内槽（Inner Well）**：`border-radius: 11px`（满足 $R_{\text{inner}} = R_{\text{outer}} - \text{padding}$ 同心圆角视觉）
- **紧凑列表行（List Row）/ 折叠面板**：`border-radius: 14px`
- **输入框 / 多行文本框（Input / Textarea）**：`border-radius: 12px`（普通输入）或 `9999px`（顶部搜索框）
- **所有按钮、下拉选择框 `<select>`、分段切换栏、状态徽章**：`border-radius: 9999px`（全胶囊）

### 3.3 现代 CSS 动效与样式注入（`GM_addStyle`）
在 `userscript/webbin.user.js:145-170` 的 `GM_addStyle` 中补充以下现代 Web 规范样式：
1. **独立变换属性（Individual Transform Properties）与基态恒等变换**：
   - 使用 `translate`、`scale`、`rotate` 替代复合 `transform` 过渡，避免入场动画与 `:hover` / `:active` 互相覆盖。
   - 凡是有 `:hover` 或 `:active` 位移/缩放的组件类（`.wi-btn`、`.wi-card`、`.wi-seg-btn`），**必须在基态声明 `translate: 0px 0px; scale: 1; rotate: 0deg;`**，防止悬浮瞬间创建新层叠上下文导致闪烁。
2. **`in oklab` 色彩空间渐变回退**：
   ```css
   [data-wi-ui] { --wi-oklab: ; }
   @supports (background: linear-gradient(in oklab, white, black)) {
     [data-wi-ui] { --wi-oklab: in oklab; }
   }
   ```
   卡片内槽背景使用：`linear-gradient(165deg var(--wi-oklab), ${C.surface} 0%, ${C.bg2} 100%)`。

---

## 4. 组件原语与小部件改造规格

### 4.1 CSP 安全 SVG 图标助手 `svgIcon(name, size)`
内置以下无文本几何路径，供搜索框、视图切换、外链、分组、眼睛等使用（不向关键测试按钮内注入任何字符）：
```js
  const SVG_PATHS = {
    search: [["circle", { cx: "11", cy: "11", r: "8" }], ["path", { d: "m21 21-4.3-4.3" }]],
    grid: [
      ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1.5" }],
      ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1.5" }],
      ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1.5" }],
      ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1.5" }],
    ],
    list: [
      ["line", { x1: "8", x2: "21", y1: "6", y2: "6" }],
      ["line", { x1: "8", x2: "21", y1: "12", y2: "12" }],
      ["line", { x1: "8", x2: "21", y1: "18", y2: "18" }],
      ["circle", { cx: "3.5", cy: "6", r: "1" }],
      ["circle", { cx: "3.5", cy: "12", r: "1" }],
      ["circle", { cx: "3.5", cy: "18", r: "1" }],
    ],
    external: [
      ["path", { d: "M15 3h6v6" }],
      ["path", { d: "M10 14 21 3" }],
      ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
    ],
    eye: [
      ["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ],
    eyeOff: [
      ["path", { d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" }],
      ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }],
      ["path", { d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" }],
      ["path", { d: "m2 2 20 20" }],
    ],
  };

  function svgIcon(name, size = 14) {
    const ns = "http://www.w3.org/2000/svg";
    const mk = (t) => (typeof document.createElementNS === "function" ? document.createElementNS(ns, t) : document.createElement(t));
    const s = mk("svg");
    s.setAttribute("width", String(size));
    s.setAttribute("height", String(size));
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.85");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.style.setProperty("flex-shrink", "0");
    for (const [tag, attrs] of SVG_PATHS[name] || []) {
      const n = mk(tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      s.append(n);
    }
    return s;
  }
```

### 4.2 胶囊按钮 `mkBtn(label, color, primary, onClick)`
- `border-radius: "9999px"`（全胶囊）
- `padding: "6px 14px"`，`font-size: "12px"`，`font-weight: "500"`
- **主按钮（`primary === true`）**：
  - 当未传特定语义色或传入 `C.accent` 时，采用 StashDock 标志性的高对比主胶囊：背景 `C.primaryBg`（浅色下为深炭黑 `#18181b`，暗色下为亮白 `#f3f4f6`）、文字 `C.primaryFg`，边框 `1px solid transparent`，阴影 `C.pillShadow`。
- **次按钮（`primary === false`）**：
  - 背景 `C.surface`，边框 `1px solid ${color || C.borderStrong}`，文字 `color || C.text`，微阴影 `0 1px 2px rgba(0,0,0,0.03)`。
- **物理按压与悬浮**：
  - 基态 `translate: "0px 0px"`, `scale: "1"`；悬浮 `translate: "0px -1px"`；按下 `scale: "0.96"`。

### 4.3 柔和凹槽输入框 `mkInput(value, placeholder)` 与胶囊选择器 `<select>`
- `mkInput`：`border-radius: "12px"`, `padding: "8px 12px"`, `background: C.bg2`, `border: 1px solid ${C.border}`；`focus` 时切换 `background: C.surface`、`border-color: C.borderStrong`、`box-shadow: 0 0 0 3px ${C.accentSoft}`。
- `makeGroupSelect` 及各处 `<select>`：统一升级为胶囊外观 `border-radius: "9999px"`, `padding: "6px 12px"`, `background: C.surface`, `border: 1px solid ${C.borderStrong}`, `box-shadow: 0 1px 2px rgba(0,0,0,0.03)`。

### 4.4 圆形勾选框 `mkCheckbox(checked)`
- 保持 `input[type="checkbox"]` 原生元素（确保所有 `cb.checked` 与 `change` 事件逻辑 100% 兼容），通过 `appearance: none` + `GM_addStyle` 定制为 StashDock 左上角同款的 **22×22px 白底圆形打勾徽章**：
  - 未选中：`width: 22px; height: 22px; border-radius: 9999px; background: ${C.surface}; border: 1px solid ${C.borderStrong}; box-shadow: ${C.pillShadow};`
  - 选中（`:checked`）：`background: ${C.primaryBg}; border-color: ${C.primaryBg};` 并用伪元素 `::after` 绘制白色对勾 `✓`。

---

## 5. 四大 Tab 逐页重构规格

### 5.1 全局面板与顶栏（`buildPanel` & `switchTab`）
1. **弹出位置联动（`applyPanelPos(overlay)`）**：
   - 读取 `$storage.get().panelPos`（在 `$storage.get()` 中新增 `panelPos: GM_getValue("panel_pos", "center") === "right" ? "right" : "center"`）。
   - 若为 `"right"`：`overlay` 设置 `justify-content: "flex-end"`, `padding: "0 16px"`；若为 `"center"`：`justify-content: "center"`, `padding: "0"`。
2. **面板容器 `panel`**：
   - `width: "min(94vw, 540px)"`, `height: "min(84vh, 640px)"`, `border-radius: "22px"`, `background: C.bg`, `border: 1px solid ${C.borderStrong}`, `box-shadow: C.panelShadow`。
3. **顶栏胶囊分段导航 `tabs`（`panel.children[0]`）**：
   - `tabs` 本身作为浅灰胶囊槽：`display: "flex"`, `gap: "4px"`, `margin: "12px 14px 6px"`, `padding: "4px"`, `background: C.bg2`, `border: 1px solid ${C.border}`, `border-radius: "9999px"`, `flex-shrink: "0"`。
   - 4 个 Tab 按钮（`当前页` / `已保存` / `对话` / `设置`）：`flex: "1"`, `padding: "7px 0"`, `border-radius: "9999px"`, `border: "none"`, `font-size: "13px"`, `cursor: "pointer"`。
   - `switchTab(key)` 中：选中按钮设置 `background: C.surface`, `color: C.text`, `font-weight: "600"`, `box-shadow: C.pillShadow`；未选中按钮设置 `background: "transparent"`, `color: C.sub`, `font-weight: "500"`, `box-shadow: "none"`。
4. **底栏 `footer`（`panel.children[2]`）**：
   - 左侧保持 `initVersionFooter(footer)` 版本检测文案；右侧显示轻量位置提示或快捷切换（点击可在 `屏幕居中` / `靠右悬浮` 间一键切换并同步存储）。

### 5.2 「已保存」Tab —— StashDock 双列 Bento 卡片与列表切换（`buildListTab`）
1. **状态新增**：
   - `let savedListView = GM_getValue("saved_list_view_v1", "grid") === "list" ? "list" : "grid";`（默认 `"grid"` 双列卡片视图）。
2. **第一行（搜索 + 视图切换 + 刷新）**：
   - 胶囊搜索框（保持 `searchInput` 为 `<input placeholder="搜索标题或网站">`，设置 `border-radius: "9999px"`, `padding: "7px 14px"`）。
   - `Grid | List` 分段胶囊切换器（浅灰胶囊槽内含 `Grid` 和 `List` 两个小胶囊按钮，带 `svgIcon("grid")` / `svgIcon("list")`，点击切换 `savedListView` 并重绘 `renderList()`）。
   - `groupFilter`（`<select>`，保持含 `"全部分组"` `<option>`，胶囊外观）+ `refreshBtn`（保持按钮文案 `"刷新"`，胶囊外观）+ `"分组管理"` 胶囊按钮。
3. **常驻毛玻璃胶囊批量栏 `bar`**：
   - 保持 `position: "sticky"`, `top: "0"`, `z-index: "3"`；外观升级为圆角毛玻璃胶囊条（`border-radius: "14px"`, `margin: "4px 0 10px"`, `padding: "7px 12px"`, `background: rgbaOf(C.bg, 0.82)`, `backdrop-filter: blur(14px)`, `border: 1px solid ${C.borderStrong}`）。
   - 内部保留全选复选框与 `AI 总结`、`就这些聊`、`移动到分组`、`下载 .md`、`删除`、`取消选择` 6 个胶囊按钮。
4. **列表容器 `listEl` 与条目卡片 `renderListItem(it, onChange)`**：
   - 当 `savedListView === "grid"` 时：`listEl` 设置 `display: "grid"`, `grid-template-columns: "repeat(2, minmax(0, 1fr))"`, `gap: "10px"`。
   - 当 `savedListView === "list"` 时：`listEl` 设置 `display: "flex"`, `flex-direction: "column"`, `gap: "8px"`。
   - **双层同心圆角卡片结构（Grid 模式下的 `row`）**：
     - 外框 `row`：`display: "flex"`, `flex-direction: "column"`, `padding: "8px"`, `border-radius: "18px"`, `background: C.card`, `border: 1px solid ${selectedIds.has(it.id) ? C.primaryBg : C.border}`, `box-shadow: C.cardShadow`。
     - **内层圆角槽 `well`**：`padding: "9px 10px"`, `border-radius: "11px"`, `background: C.surface`, `border: 1px solid ${C.border}`, `min-height: "68px"`, `display: "flex"`, `flex-direction: "column"`, `justify-content: "space-between"`。
       - 槽顶行：左侧放圆形 `cb`（`mkCheckbox`），右侧放 `badges` 胶囊徽章（`📺B站` / `✨已总结` / `✅已归档`）。
       - 槽底行：展示分组名称与保存时间（`font-size: "11px"`, `color: C.sub`）。
     - **外框下半部 `textBlock`**：`padding: "8px 4px 2px"`，上方为 2 行截断粗体标题 `it.title`（`font-weight: "600"`, `font-size: "13px"`, `line-height: "1.4"`），下方为来源域名 `it.site` + 外链跳转小图标 `↗`（点击 `↗` 打开 `it.url`，点击卡片其余区域触发 `openDetail(row, it.id)`）。
   - **详情展开 `openDetail(row, id)`**：
     - 保持 `row.after(detail)` 契约（`detail._detail = true`）；在 Grid 模式下为 `detail` 添加 `grid-column: "1 / -1"`，使其横跨两列平滑展开双层圆角详情卡，不挤歪网格！

### 5.3 「当前页」Tab（`buildSaveTab`、`buildUpBatchSection`、`buildBatchSaveSection`）
- 将标题输入框、分组选择行、主次动作按钮包裹进一张双层圆角 Bento 卡片容器（`padding: "12px"`, `border-radius: "18px"`, `background: C.card`, `border: 1px solid ${C.border}`）。
- 正文/字幕预览区 `preview` 作为卡片内部的同心圆角内槽（`border-radius: "12px"`, `background: C.surface`, `border: 1px solid ${C.border}`）。
- `buildUpBatchSection` 与 `buildBatchSaveSection` 同样升级为 `border-radius: "18px"` 的 Bento 卡片外观，保持内部 `<select>`（共 2 个分组选择器 + 空间页 1 个预设选择器）和 2 个 `<input type="date">` 节点及所有原有文案不变。

### 5.4 「对话」Tab（`buildChatTab`）
- **顶栏 `topRow`**：`新会话`、`历史`、`⟳ 索引` 三个按钮升级为 StashDock 描边胶囊按钮（`border-radius: "9999px"`, `background: C.surface`, `border: 1px solid ${C.borderStrong}`, `padding: "5px 12px"`）。
- **消息流 `msgs`**：
  - **必须保留 `padding: "6px 2px"`**（匹配 `test/chat-loop.test.mjs` 的 `msgsElOf` 选择器）。
  - 用户气泡：`border-radius: "18px 18px 6px 18px"`, `background: C.primaryBg`, `color: C.primaryFg`, `box-shadow: C.pillShadow`。
  - 工具调用卡片 `buildToolCard`：`border-radius: "14px"`, `background: C.card`, `border: 1px solid ${C.border}`；内部展开框 `detailBox` 为 `border-radius: "10px"`, `background: C.surface`（保留 `"📄 读取"` 与 `"已截断"` 文案）。
  - 助手回答卡片：`border-radius: "6px 18px 18px 18px"`, `background: C.surface`, `border: 1px solid ${C.border}`, `box-shadow: C.cardShadow`；底部引用来源渲染为小巧的圆角胶囊标签。
- **底部输入岛 `composer`**：
  - 升级为悬浮大圆角胶囊岛：`border-radius: "18px"`, `background: C.bg2`, `border: 1px solid ${C.borderStrong}`, `padding: "8px 10px"`。
  - 底部左/右侧的 `分组`、`资料`、`模型` 触发按钮升级为白底圆角小胶囊（`border-radius: "9999px"`, `background: C.surface`, `border: 1px solid ${C.border}`）；上浮面板 `panel` 升级为 `border-radius: "16px"`, `box-shadow: C.panelShadow`。
  - 发送按钮 `sendBtn` 保持空闲 `"➤"` / 运行中 `"■"` 文案契约，尺寸 `34px × 34px` 圆形胶囊。

### 5.5 「设置」Tab（`buildSettingsTab`）
1. **卡片 1（新增）：界面与弹出位置**
   - 双层圆角卡片（`border-radius: "18px"`, `background: C.card`, `padding: "12px"`），内含标题 `"界面与弹出位置"` 与右侧胶囊分段器 `[ 屏幕居中 | 靠右悬浮 ]`。
   - 点击选项时调用 `$storage.set("panelPos", pos)`，并立即调用 `applyPanelPos(panelEl)` 实时移动当前打开的面板位置，同时弹出 `toast` 提示。
2. **卡片 2：Cloudflare Worker 连接**
   - 包含 `Worker 地址`（保留 `placeholder: "https://webbin.xxx.workers.dev"`）、`Token`（配 `svgIcon("eye")` / `svgIcon("eyeOff")` 切换明文）、以及 `保存连接信息`、`测试连接`、`读取云端 LLM 配置` 三个胶囊按钮。
3. **卡片 3：LLM 模型配置与分组管理**
   - 包含 `API Base`、`API Key`、`模型选择` 与 `renderGroupManager()`，全部装入圆角 Bento 卡片容器。

---

## 6. 建议实施步骤与验收清单（供 Astra 执行）

1. **Step 1：升级调色板 `C`、全局 `GM_addStyle` 样式表与 `svgIcon` 辅助函数**
   - 更新 `C` 颜色 Token，加入 `.wi-seg-btn`、`.wi-card` 等动画与独立变换基态（`translate: 0px 0px; scale: 1; rotate: 0deg;`）。
2. **Step 2：升级基础组件（`mkBtn`、`mkInput`、`mkCheckbox`、`makeGroupSelect`）与 `buildPanel` / `switchTab`**
   - 面板尺寸设为 `min(94vw, 540px) × min(84vh, 640px)`，实现 `panel_pos`（`center` / `right`）定位支持与顶栏 4 按钮胶囊分段导航。
3. **Step 3：重构四大 Tab 视图（`buildListTab`、`buildSaveTab`、`buildChatTab`、`buildSettingsTab`）**
   - 在 `buildListTab` 中实现 `Grid`（双列同心圆角无图卡片，展开详情时 `grid-column: 1 / -1`）与 `List` 切换；在 `buildSettingsTab` 中加入「屏幕居中 / 靠右悬浮」设置卡片。
4. **Step 4：同步更新 `dev/preview.html` 与运行全套验证**
   - 在 `D:\Project\Tools\Webbin\webbin` 下执行：
     ```powershell
     node --check userscript/webbin.user.js
     npm.cmd test
     git diff --check
     ```
   - 确认现有 **198 条测试全部通过（0 failed）**，并在 `test/panel-tabs.test.mjs` 或 `test/batch-ui.test.mjs` 中补充针对「弹出位置设置切换（`center` ⇄ `right`）」与「已保存列表 `Grid / List` 视图切换」的断言。
