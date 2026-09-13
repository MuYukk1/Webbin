<div align="center">
  <img src="assets/webbin_icon_coral.png" width="160" alt="Webbin" />
  <h1>Webbin</h1>

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f6821f)](https://workers.cloudflare.com/)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-UserScript-00485b)](https://www.tampermonkey.net/)
[![Userscript Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fwebbin.arevlx.workers.dev%2Fuserscript.user.js&query=%24.version&prefix=v&label=script)](https://github.com/MuYukk1/webbin)

</div>

[Webbin](../bili-inbox) 收集箱的 Cloudflare Worker 后端:存储网页/B站链接、管理 LLM 配置(存 KV,key 前端只回显掩码)、转发 AI 总结请求、接收 PC 归档脚本的状态回写。

客户端:双端 Edge 的 Tampermonkey 油猴脚本(`userscript/webbin.user.js`,本仓库也提供自动更新源)+ PC 归档脚本(本地项目 `bili-inbox/`)。

## 安装油猴脚本

脚本由 **Worker 自己托管**(路由 `/userscript.user.js`,公开访问),**部署即最新**,不依赖任何第三方 CDN——安装地址就是你自己 Worker 的地址,更新不再有 CDN 缓存延迟:

```
https://<你的Worker域名>/userscript.user.js
```

推荐统一用「**从 URL 安装**」,安装和更新走同一条路:

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展(桌面 Edge/Chrome 的应用商店;安卓 Edge 商店同样上架了 Tampermonkey,双端用同一份脚本)
2. 点击浏览器工具栏的 Tampermonkey 图标 → **管理面板**
3. 切到「**实用工具**」标签 → 找到「**从 URL 安装**」→ 粘贴上面的安装地址(先把 `<你的Worker域名>` 换成第 4 步部署得到的地址)→ 点「安装」
4. 首次使用:任意网页点右下角 📥 悬浮按钮 → 「设置」→ 填 **Worker 地址**(部署后得到的 `https://<name>.<account>.workers.dev`)和 **Token**(部署时的 `WORKER_TOKEN`)→ 保存

**更新方式**(任选其一):

- **自动**:Tampermonkey 会定期按安装地址后台检查并提示更新(Worker 部署完成即最新,无缓存等待)
- **手动检查**:管理面板 → 已安装脚本里选中本脚本 → 「实用工具」→「检查更新」
- **直接覆盖**:重复上面的「从 URL 安装」,同名同 namespace 原地覆盖,本地设置不丢

> 收集箱面板底部会显示当前版本号,有新版时可直接点击打开安装页。

## 部署 Cloudflare Worker(完整步骤)

后端跑在 Cloudflare 免费额度上,零常驻服务,不需要本地环境,全程约 10 分钟。

### 1. Fork 本仓库

点右上角 Fork。Fork 后到仓库 **Actions** 标签页确认工作流已启用(若提示则点 "I understand my workflows, go ahead and enable them")。

### 2. 创建 KV 命名空间

[Cloudflare Dashboard](https://dash.cloudflare.com) → 左侧 **Storage & Databases → KV**(旧版界面在 **Workers & Pages → KV**)→ **Create namespace**,名字随意(如 `webbin`)→ 进入详情**复制 Namespace ID**(32 位十六进制串)。

也可以用 CLI:`npx wrangler kv namespace create KV`,取输出中的 `id`。

### 3. 记下 Account ID

点击右上角Ask AI，选择账户内用户名下方就是账户ID。

### 4. 创建 API Token

[Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → 选 **"Edit Cloudflare Workers"** 模板(已包含部署 Worker 与操作 KV 所需权限)→ Create Token → **复制生成的 token**(只显示一次)。第3步的Account ID也可以在这一步看到。

### 5. 配置仓库 Secrets

Fork 的仓库 → **Settings → Secrets and variables → Actions** → **New repository secret**,逐个添加:

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第 4 步生成的 token |
| `CLOUDFLARE_ACCOUNT_ID` | 第 3 步的 Account ID |
| `KV_NAMESPACE_ID` | 第 2 步的命名空间 ID |
| `WORKER_TOKEN` | 自己生成的一串随机字符(≥32 位),作为客户端访问口令;油猴脚本设置页与 PC 脚本配置里填同一个值 |

### 6. (可选)改 Worker 名字

`wrangler.toml` 中 `name = "webbin"` 可改成自己的名字,它决定访问域名 `https://<name>.<account-subdomain>.workers.dev`。

### 7. 部署与验证

推送到 main(或在 **Actions → Test & Deploy → Run workflow** 手动触发)→ 等所有任务变绿 → 浏览器打开 `https://<name>.<account-subdomain>.workers.dev/`,看到:

```json
{"app": "webbin", "ok": true, "hint": "服务正常,请通过油猴脚本或 PC 脚本访问"}
```

即部署成功。回到油猴脚本「设置」页填入 Worker 地址和 Token 即可使用。

> `wrangler.toml` 里的 `__KV_ID__` / `__WORKER_TOKEN__` 是占位符,部署时由 Action 从 Secrets 注入,真实值不会进仓库。

## 本地开发

```bash
npm install -g wrangler
wrangler kv namespace create KV   # 把 id 填入 wrangler.toml,并把 TOKEN 改为随机串
npm test                          # 路由逻辑测试(stub KV,无外部依赖)
wrangler deploy
```

## API 一览

所有 `/api/*` 请求需带 `x-token` 请求头(值 = `WORKER_TOKEN`):

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/save` | 保存条目 `{url, title, site, type, content, group_id?}` |
| GET | `/api/items` | 列表(摘要,不含正文;`?full=1` 全量;条目含 `group_id`) |
| GET/DELETE | `/api/item/:id` | 单条 / 删除 |
| POST | `/api/summarize` | 对条目正文生成 AI 总结 `{id}` |
| POST | `/api/status` | PC 归档脚本回写 `{id, status, archive, summary}` |
| GET/POST | `/api/settings` | LLM 配置(GET 回显掩码 key;POST 留空/掩码不覆盖) |
| POST | `/api/models` | 代理拉取 `{api_base}/models` 模型列表 |
| GET/POST | `/api/groups` | 分组列表 / 管理(`{action: create\|rename\|delete, id?, name?}`) |
| POST | `/api/group/assign` | 批量移动条目 `{ids[≤200], group_id}` |
| GET | `/api/kb/metadata` | 有界分页元数据 `?cursor=&limit=`(单页 ≤40;含标题/来源/分组/摘要,不含正文) |
| POST | `/api/chat` | 知识库对话代理:透传 `{messages, tools?, model?}` 到 chat completions,支持原生工具调用;默认用设置页模型,可用 `model` 覆盖 |

## 知识库对话(对话 Tab)

油猴面板「对话」Tab 基于收藏内容做问答,采用**工具调用 Agent** 形式:资料全文不会一次性塞给模型,助手通过三个只读工具自主检索和阅读——`list_items`(浏览范围)、`search_kb`(搜标题/总结)、`read_item`(分段读正文,长文用 `next_cursor` 续读)。

- **范围**:输入框下方「分组」「资料」两个多选下拉(按分组可全选;按资料可搜索点选,也可在列表勾选后点「就这些聊」,最多 20 条,摘要自动注入、正文仍按需读取)。范围即权限,模型无法用工具参数读到范围外的条目;**首轮发送时锁定范围快照**,运行中改勾选只影响下一轮。首次使用未选过范围时自动全选分组(范围=全库,可随时收窄)。
- **预算护栏**:单轮问答最多 8 次模型请求、16 次工具执行,累计注入工具正文 ≤24000 字符;到限明确终止并提示,不静默截断。
- **分组**:设置页可增删改分组;删除分组不删资料,组内条目自动按默认组解释。
- **会话**:保存在油猴脚本本地(GM 存储),切 Tab/收起面板不丢;刷新页面会中断运行中的回答(恢复历史并标注中断,不自动重发)。当前会话上限 60 条;开始新会话时上一段自动存入**历史**(顶栏「历史」,最多 20 段),可随时查看、继续或删除;点开历史会话不会让它消失,继续聊后原地更新原条目并置顶。
- **安全**:模型请求经 Worker 代理,API Key 不出服务端;资料内容按数据注入(提示注入不可触发写入/删除/越权);回答区纯文本渲染,引用可点击跳转原文。

## 说明

仅用于个人收藏同步,数据全在自己账号的 KV 中;`WORKER_TOKEN` 等同访问密码,请勿外传。
