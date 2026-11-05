# Webbin 部署与更新手册

首次使用：点部署按钮 → 登录并授权 → 设置访问口令 → 部署 → 安装脚本。
以后：维护者 push,用户运行「更新 Webbin」,都由 Cloudflare 自动构建并部署。

## 新用户：点击部署按钮之后

### 1. 登录、授权并复制仓库

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FMuYukk1%2FWebbin)

1. 点击按钮。没有 Cloudflare 账号就先注册,已有账号直接登录。
2. 按向导连接自己的 GitHub 账号。如果跳转 GitHub 授权页,授权后返回 Cloudflare。
3. 选择在自己的 GitHub 账号下创建仓库副本,仓库名保持 `Webbin` 即可。不用先 Fork,不用手动导入仓库。
4. Worker 名字先保持 `webbin`。向导可以一起修改名字与配置;不要只在 CF 单独改名,否则与 `wrangler.toml` 不一致可能导致后续构建失败。

这会创建用户自己的仓库和服务,不会连接作者的收藏库。官方按钮复制的仓库不一定具有 Fork 关系,以后使用本项目的更新工作流。

### 2. 设置一个访问口令

在向导的 **Worker secrets / 密钥** 中找到 `TOKEN`。不同界面可能放在展开的配置区域,请查找名称 `TOKEN`。

| 字段 | 填写内容 |
|---|---|
| Secret 名称 | `TOKEN`,全部大写 |
| 值 | 用密码管理器生成并保存的一串至少 32 位随机字符 |

这是 Webbin 的访问密码。它不是 Cloudflare 登录密码、CF API Token 或 AI API Key。稍后在油猴脚本里填相同的值。

不要将口令填写成普通构建环境变量。`Build variables and secrets` 只在构建时可用,不能代替 Worker 的运行时 Secret。

### 3. 点击 Deploy

确认向导中的设置：

| 项目 | 值 |
|---|---|
| 生产分支 | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| 根目录 | 仓库根目录,保持默认 |
| API Token | 使用 CF 自动生成的选项 |

点击 **Deploy**。CF 会按 `.node-version` 使用 Node 22,安装锁定的依赖、运行测试、自动创建并绑定 KV、部署 Worker。无需创建 KV、复制 Namespace ID 或填写 GitHub Secrets。

保持 Workers Free 计划即可使用受限免费额度;模型服务费用独立计算。不需要为此开通付费功能。

### 4. 复制服务地址

部署成功后,CF 会提供类似地址：

```text
https://webbin.你的子域.workers.dev
```

复制并保存。如果 CF 首次提示设置 `workers.dev` 子域,按页面提示完成。

打开该地址,应返回含 `"app":"webbin","ok":true` 的 JSON。首页响应只确认程序能运行;真正的口令和 KV 连接在下一步测试。

在 Worker 的 **Bindings** 中应看到名为 `KV` 的 KV Namespace。只需确认,不必另建 KV 或改绑定名。

### 5. 安装脚本并测试连接

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 在自己的服务地址后加 `/userscript.user.js`,例如 `https://webbin.你的子域.workers.dev/userscript.user.js`。
3. 打开这个地址并在 Tampermonkey 页面安装。若只显示代码,打开 Tampermonkey 管理面板 → 实用工具 → 从 URL 安装,粘贴完整地址。
4. 在普通网页打开 Webbin → 设置。
5. Worker 地址填服务首页地址,不要带 `/userscript.user.js`;Token 填第 2 步的口令。
6. 点击「保存连接信息」,再点「测试连接」。看到连接成功后,保存一篇文章并在收集箱确认内容可读。

AI 设置仍在 Webbin 面板中完成：填写 API Base 和 Key → 保存 LLM 配置到云端 → 刷新模型列表、选模型并保存。不填 AI 也可以先收藏。

### 6. 向导没有收集 TOKEN,或提示缺少密钥

若 CF 已创建 Worker 但构建报缺少 `TOKEN`,不要把口令填入源码：

1. 打开该 Worker → **Settings → Variables and Secrets → Add**。
2. 类型选 **Secret**,名称填 `TOKEN`,值填自己的口令,保存并部署。
3. 回到 **Builds**,重新运行构建。如果只是修改 Build 配置,也要重新触发构建才会应用。

若 Worker 尚未创建,返回部署向导补填 Worker Secret。不要为了排错新建第二个 Worker/KV。

## 以后如何更新

1. 打开自己的 GitHub 仓库,进入 **Actions**。
2. 如提示尚未启用 Actions,先点击启用。
3. 左侧选择 **更新 Webbin**,点击 **Run workflow**,分支保持 `main`,再确认运行。
4. 等「更新 Webbin」工作流成功。它先在只读作业里同步和测试作者仓库 `MuYukk1/Webbin` 的 `main`。测试通过后，推送作业从干净的检出重新核对同一个上游提交，只提交通过路径和内容校验的变更。如果上游在测试期间有新提交，重新运行更新即可。
5. 回到 CF 的该 Worker → **Builds**,确认新提交对应的生产部署成功。GitHub 更新工作流成功不等于 CF 部署已经完成。
6. 如有脚本新版,在 Tampermonkey 中检查更新或从自己原来的安装地址重新安装。

只更新应用代码,不会更换 KV、口令、模型配置或工作流。没有新版时不会制造空提交。不要重新点首次部署按钮更新,否则会创建另一套服务。

更新工作流的推送作业使用 GitHub 内置 `GITHUB_TOKEN`。只读测试作业和依赖安装无法取得该写凭证。若提示无法推送，检查仓库 **Settings → Actions → General** 的权限策略及 `main` 分支保护。

更新器保留 `wrangler.toml`、`.github/`、本地密钥文件及用户新增文件;发布清单内自行修改的已提交代码会被上游版本替换,上游已移除的发布文件会删除。上游新增文件与个人文件同名时停止,不会覆盖个人文件。工作区有未提交修改时停止。部署模板/工作流有不兼容升级时,由部署版本检查停止更新并提示迁移,不会假装全部更新成功。

## 现有 Worker 迁移

本节用于已经通过旧 GitHub Action 部署、已有收藏数据的维护者。不要使用首次部署按钮重建。

1. 在 CF 打开**现有 Worker**,记录其名字和 **Bindings → KV** 指向的原命名空间,保留原绑定。
2. 打开 **Settings → Variables and Secrets**,确认运行时有 `TOKEN`,使用与原 `WORKER_TOKEN` 完全相同的值。若原来是明文变量,将其改为 Secret 后保存;不要更换口令,客户端就无需重配。
3. 将本次改造代码推送到原 GitHub 仓库。旧的部署工作流已移除,不会再使用 GitHub 的 CF Secrets 发布。
4. 在**现有 Worker**的 **Settings → Build** 连接自己的 GitHub 仓库,选择 `main`,Build command 填 `npm run build`,Deploy command 填 `npm run deploy`。CF Worker 名字须与仓库 `wrangler.toml` 的 `name` 一致。
5. 触发一次构建。新配置声明 `KV` 而不指定新 ID,Wrangler 会沿用已有的资源绑定;不要选择新建命名空间。若你的仓库已有真实 `id`,保留它。
6. 构建成功后检查 KV 仍指向原命名空间,在油猴中测试连接并确认能看到原收藏,再测试保存和读取一条新内容。
7. 确认 CF Git 自动部署正常后,GitHub 中旧的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`KV_NAMESPACE_ID`、`WORKER_TOKEN` 不再用于部署,可自行清理。不要删除 CF 中的 KV 或 TOKEN。

后续维护者直接 push，CF 自动测试并部署。仓库里的「更新 Webbin」Action 供用户同步新版，在作者仓库运行时会提示无需同步。

## 排错

| 现象 | 处理方式 |
|---|---|
| CF 找不到仓库 | 检查 GitHub App 是否获准访问自己的仓库 |
| 构建缺少 TOKEN | 按上文补充 Worker 运行时 Secret,而非 Build variable |
| 找不到 wrangler 或测试环境版本不对 | 使用 `npm ci` 和 Node 22.15+,不要跳过依赖安装;CF 构建按仓库锁文件安装 |
| 脚本提示 Token 无效 | 核对大写 `TOKEN`、值是否相同、是否保存部署 |
| 首页正常但收藏不可用 | 核对 `KV` 绑定及脚本的「测试连接」结果 |
| 更新 Action 成功但没有新版服务 | 在 CF 检查 Git 集成、生产分支和对应提交的 Build;必要时手动重试该构建 |
| 更新提示需要迁移 | 阅读上游本手册,保留原 KV 与 Secret,不要用首次部署重建 |
| 服务地址打不开 | 检查地址和当前网络可达性,部署成功不代表所有网络都能访问 |

## 维护部署模板

`package.json` 中 `webbin.deploymentVersion` 是更新兼容约定。变更绑定、Worker 入口、必需密钥或工作流的调用协议,且需要用户手动迁移时必须递增该值,并在本手册写迁移步骤。普通应用更新不递增。

迁移说明必须列出目标版本号、需修改的配置或工作流,以及验证方法。用户完成列出的配置修改后,在自己的 GitHub 仓库编辑 `package.json` 的 `webbin.deploymentVersion` 为说明中的目标值,提交到 `main`,再运行「更新 Webbin」。不要仅修改版本号绕过未完成的迁移。目前首次发布版本为 1,没有后续迁移要求。

新增或移除应用文件后,维护者先用 `git add` 暂存准备发布的文件和删除项,再运行 `npm run manifest`,将 `scripts/upstream-files.json` 与代码一起提交。生成器只收集已跟踪/已暂存的文件,不会把未跟踪的个人草稿加入发布清单。更新器用上次发布清单识别应删除的文件,而非清空用户目录;上游发布清单遗漏文件时会停止。

更新器不会自动更新 `.github/`、`wrangler.toml`、`.dev.vars.example` 或 `.gitignore`。模板升级需要人工处理;不能承诺一次普通更新自动获得这些文件的新版本。

## 官方依据与验证边界

- [部署按钮：仓库复制、资源创建及 Worker secrets 声明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Wrangler 自动创建资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [CF Git 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [构建与运行时变量的区别](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Worker Secret 设置](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

本地可验证资源声明、打包、更新范围与失败保护。CF 登录授权、向导实际收集 TOKEN、Actions 推送触发 CF 构建及线上数据保留,仍需在自己的测试账户完成一次端到端验收;不要把本地测试通过当作已部署成功。
