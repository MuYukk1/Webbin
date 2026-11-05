# Webbin CF 部署与更新交接

日期：2026-11-05。状态：已完成本地实现，未提交、未推送、未修改线上 Worker。

## 已确认的流程

- 新用户使用官方 Deploy to Cloudflare，复制仓库、创建 KV、填写 Worker `TOKEN`、安装脚本。保留 Workers Free，不要求 CF API Token、Account ID 或 GitHub 部署 Secrets。
- 维护者直接 push `main`；用户在自己的仓库手动运行「更新 Webbin」。两边都由 CF Workers Builds 运行 `npm run build` 和 `npm run deploy`。
- 老用户迁移使用现有 Worker、原 KV 和相同口令。操作手册见 `docs/DEPLOY.md`。

## 入口和不变量

- `wrangler.toml` 保留 `KV` 绑定和 Text 模块规则，无默认 KV ID 或真实 TOKEN；`.dev.vars.example` 声明向导收集的 secret，`package-lock.json` 固定 Wrangler。
- `.github/workflows/update.yml` 是唯一的 Actions 工作流。测试作业只有 `contents: read`。推送作业从同一基准提交重新检出，核对通过测试的上游版本，并在推送阶段使用 `contents: write` 凭证。
- 更新器保留部署配置、工作流和用户新增文件。以字面路径同步，写入前检查文件和目录冲突，提交前按预期清单核对暂存路径、内容和模式。
- 维护者变更发布文件集合时，先暂存要发布的文件，再执行 `npm run manifest`。需要手工迁移的部署变更递增 `webbin.deploymentVersion`，并在手册补充迁移操作。

## 验证与待办

- Node 22.23.4 下 `npm run build` 通过，共 213 项既有断言与 18 项更新器回归。临时 Git 仓库覆盖方括号文件名、文件和目录冲突、暂存内容被替换、独立检出后推送及上游版本变化。
- `wrangler deploy --dry-run` 成功构建 277.26 KiB 的 Worker，识别 `env.KV`，未部署。
- 发布后需在测试账户核验：官方向导复制工作流及收集 `TOKEN`、自动绑定 KV、更新 Action 推送后触发 CF 构建、原 KV 与口令在重复部署后仍保留。
- 真实上线前按手册迁移现有 Worker 并确认绑定；不要为验证重建生产 KV，也不要把临时测试结果当作云端验收。
