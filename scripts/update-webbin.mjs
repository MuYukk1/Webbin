// 用户仓库只同步应用文件;部署配置、工作流和私有配置始终留在原处。
import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UPSTREAM = "https://github.com/MuYukk1/Webbin.git";
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const FILES = new Set([".node-version", "index.js", "package.json", "package-lock.json", "README.md"]);
const DIRECTORIES = ["userscript/", "test/", "assets/", "dev/", "docs/", "scripts/"];
const MANIFEST = "scripts/upstream-files.json";
// TLD 必须有字母,避免把 @mozilla/readability@0.5.0 等包版本当成邮箱。
const EMAIL = /[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*\.[a-z]{2,63}\b/gi;

export function isManaged(path) {
  return FILES.has(path) || DIRECTORIES.some((dir) => path.startsWith(dir));
}

function git(cwd, args, options = {}) {
  return execFileSync("git", ["--literal-pathspecs", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function entries(output) {
  return output.split("\0").filter(Boolean).map((entry) => {
    const tab = entry.indexOf("\t");
    return { path: entry.slice(tab + 1), fields: entry.slice(0, tab).split(" ") };
  });
}

function tree(cwd, ref) {
  return new Map(entries(git(cwd, ["ls-tree", "-r", "-z", ref])).map(({ path, fields: [mode, , oid] }) => [path, { mode, oid }]));
}

function contract(pkg) {
  const version = pkg.webbin?.deploymentVersion;
  if (!Number.isInteger(version) || version < 1) throw new Error("缺少部署兼容版本。请先阅读上游部署迁移说明,不要覆盖自己的 wrangler.toml。");
  return version;
}

function manifest(text) {
  const paths = JSON.parse(text);
  if (!Array.isArray(paths) || !paths.includes(MANIFEST) || new Set(paths).size !== paths.length ||
      paths.some((path) => typeof path !== "string" || !isManaged(path) || path.split("/").some((part) => ["..", ".", ""].includes(part)) || path.includes("\\"))) {
    throw new Error("上游文件清单无效,已停止更新。");
  }
  return paths;
}

function parents(path) {
  const dirs = [];
  for (let end = path.indexOf("/"); end !== -1; end = path.indexOf("/", end + 1)) dirs.push(path.slice(0, end));
  return dirs;
}

function checkPaths(cwd, paths, local, localManifest) {
  const localDirs = new Set([...local.keys()].flatMap(parents));
  for (const path of paths) {
    for (const dir of parents(path)) {
      const entry = lstatSync(resolve(cwd, dir), { throwIfNoEntry: false });
      if (local.has(dir) || (entry && !entry.isDirectory())) throw new Error(`应用路径存在文件与目录冲突或符号链接：${dir}`);
    }
    const entry = lstatSync(resolve(cwd, path), { throwIfNoEntry: false });
    if (localDirs.has(path) || (entry && !entry.isFile())) throw new Error(`应用路径存在文件与目录冲突或符号链接：${path}`);
    if (!localManifest.has(path) && (local.has(path) || entry)) throw new Error(`上游新增文件与个人文件同名：${path}`);
  }
}

function verifyStaged(cwd, expected) {
  const paths = git(cwd, ["diff", "--cached", "--no-renames", "--name-only", "-z"]).split("\0").filter(Boolean);
  const index = new Map(entries(git(cwd, ["ls-files", "--stage", "-z"])).map(({ path, fields }) => [path, fields.join(" ")]));
  if (paths.length !== expected.size || paths.some((path) => !expected.has(path)) ||
      [...expected].some(([path, entry]) => index.get(path) !== (entry ? `${entry.mode} ${entry.oid} 0` : undefined))) {
    throw new Error("暂存范围发生变化或文件内容与预期不符，已停止更新。");
  }
}

export function prepareUpdate({ cwd = process.cwd(), upstream = UPSTREAM, ref = "main", testedSha } = {}) {
  if (git(cwd, ["status", "--porcelain"]).trim()) throw new Error("工作区不干净,已停止更新以保留本地修改。");
  const localPackage = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  // 不 merge 上游提交历史:其中可能修改 workflow,普通 GITHUB_TOKEN 无权推送这些修改。
  git(cwd, ["fetch", "--no-tags", "--depth=1", upstream, ref]);
  const sha = git(cwd, ["rev-parse", "FETCH_HEAD"]).trim();
  if (testedSha !== undefined && sha !== testedSha) throw new Error("上游在测试后有新提交，请重新运行更新。");
  const base = git(cwd, ["rev-parse", "HEAD"]).trim();
  const upstreamPackage = JSON.parse(git(cwd, ["show", `${sha}:package.json`]));
  if (contract(localPackage) !== contract(upstreamPackage)) {
    throw new Error("新版需要部署迁移,尚未修改任何应用文件。请阅读上游 docs/DEPLOY.md 的迁移说明,完成后再更新。");
  }
  const remote = new Map([...tree(cwd, sha)].filter(([path]) => isManaged(path)));
  if ([...remote.values()].some(({ mode }) => !["100644", "100755"].includes(mode))) {
    throw new Error("上游应用目录含符号链接或子模块,已停止更新。");
  }
  const localManifest = new Set(manifest(git(cwd, ["show", `HEAD:${MANIFEST}`])));
  const nextManifest = manifest(git(cwd, ["show", `${sha}:${MANIFEST}`]));
  if (remote.size !== nextManifest.length || nextManifest.some((path) => !remote.has(path))) {
    throw new Error("上游发布文件清单未更新,请维护者运行 npm run manifest 后再发布。");
  }
  const local = tree(cwd, base);
  const expected = new Map();
  for (const path of new Set([...nextManifest, ...localManifest])) {
    const before = local.get(path);
    const after = remote.get(path);
    if (before?.oid !== after?.oid || before?.mode !== after?.mode) expected.set(path, after);
  }
  const changed = [...expected.keys()];
  checkPaths(cwd, new Set([...nextManifest, ...changed]), local, localManifest);
  // NUL 分隔配合字面路径模式，方括号等字符不会匹配其他文件。
  if (changed.length) git(cwd, ["restore", `--source=${sha}`, "--staged", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], {
    input: changed.join("\0") + "\0", stdio: ["pipe", "pipe", "pipe"],
  });
  verifyStaged(cwd, expected);
  return { sha, base, changed, expected };
}

function auditEmails(text, label) {
  const emails = text.match(EMAIL) || [];
  if (emails.some((email) => email !== BOT_EMAIL && !/@example\.(com|org|net|invalid)$/i.test(email))) {
    throw new Error(`${label} 含需要人工确认的邮箱,未提交或推送。`);
  }
}

export function commitUpdate({ cwd = process.cwd(), sha, base, expected }) {
  if (git(cwd, ["rev-parse", "HEAD"]).trim() !== base) throw new Error("本地基准提交已变化，已停止更新。");
  verifyStaged(cwd, expected);
  for (const [path, entry] of expected) {
    if (entry) auditEmails(git(cwd, ["show", `:${path}`]), `暂存文件 ${path}`);
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: BOT_NAME, GIT_COMMITTER_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: BOT_EMAIL, GIT_COMMITTER_EMAIL: BOT_EMAIL,
  };
  for (const role of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    if (!git(cwd, ["var", role], { env }).includes(`<${BOT_EMAIL}>`)) throw new Error("提交身份校验失败。");
  }
  const message = `chore: update Webbin from upstream ${sha.slice(0, 12)}`;
  auditEmails(message, "提交消息");
  const expectedTree = git(cwd, ["write-tree"]).trim();
  git(cwd, ["-c", "core.hooksPath=/dev/null", "-c", "user.name=" + BOT_NAME, "-c", "user.email=" + BOT_EMAIL, "commit", "-m", message], { env });
  const [author, committer, parent, actualTree, body] = git(cwd, ["show", "-s", "--format=%ae%x00%ce%x00%P%x00%T%x00%B", "HEAD"]).split("\0");
  if (author !== BOT_EMAIL || committer !== BOT_EMAIL || parent !== base || actualTree !== expectedTree || body.trim() !== message) {
    throw new Error("提交后身份、消息或内容校验失败，未推送。");
  }
}

function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");
}

async function main() {
  const phase = process.argv[2];
  if (phase !== "prepare" && phase !== "publish") throw new Error("请从 GitHub Actions 运行「更新 Webbin」。");
  const pushToken = process.env.WEBBIN_PUSH_TOKEN;
  delete process.env.WEBBIN_PUSH_TOKEN;
  if (process.env.GITHUB_REPOSITORY?.toLowerCase() === "muyukk1/webbin") {
    summary("这是上游维护仓库。维护者直接 push,由 Cloudflare 自动部署,无需运行同步。");
    return;
  }
  const cwd = process.cwd();
  const testedSha = process.env.WEBBIN_TESTED_SHA;
  if (phase === "publish" && !/^[a-f0-9]{40}$/.test(testedSha ?? "")) throw new Error("缺少已测试的上游提交，已停止发布。");
  const result = prepareUpdate({ cwd, testedSha: phase === "publish" ? testedSha : undefined });
  if (!result.changed.length) {
    summary("应用代码已是最新版本,没有提交或重新部署。");
    return;
  }
  if (phase === "prepare") {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${result.sha}\n`);
    summary(`准备测试上游 ${result.sha.slice(0, 12)} 的 ${result.changed.length} 个应用文件。`);
    return;
  }
  if (!pushToken) throw new Error("缺少推送凭证，已停止发布。");
  commitUpdate({ cwd, ...result });
  const auth = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${pushToken}`).toString("base64")}`;
  git(cwd, ["-c", "core.hooksPath=/dev/null", "--config-env=http.https://github.com/.extraheader=WEBBIN_PUSH_AUTH", "push", "origin", "HEAD:refs/heads/main"], {
    env: { ...process.env, WEBBIN_PUSH_AUTH: auth },
  });
  summary(`已同步上游 ${result.sha.slice(0, 12)} 并推送。KV 绑定、口令和工作流保持原样。请到 Cloudflare 的 Builds 查看本次部署结果;本工作流成功不等于 CF 部署已完成。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // 不输出原始 git 命令/凭证或完整堆栈。
    console.error(error.status ? "更新命令失败,未强制推送。请检查仓库写权限、分支保护和网络。" : error.message);
    process.exitCode = 1;
  });
}
