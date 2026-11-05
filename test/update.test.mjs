import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { commitUpdate, isManaged, prepareUpdate } from "../scripts/update-webbin.mjs";

const botEmail = "41898282+github-actions[bot]@users.noreply.github.com";
const botEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "github-actions[bot]", GIT_COMMITTER_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: botEmail, GIT_COMMITTER_EMAIL: botEmail,
};
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: botEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function put(cwd, path, value) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), value);
}
function commit(cwd, stage = true) {
  if (stage && basename(cwd) === "upstream") {
    const paths = git(cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean).filter(isManaged);
    put(cwd, "scripts/upstream-files.json", JSON.stringify([...new Set([...paths, "scripts/upstream-files.json"])].sort()));
  }
  if (stage) git(cwd, "add", ".");
  for (const role of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) assert.ok(git(cwd, "var", role).includes(`<${botEmail}>`));
  // Fixtures contain only synthetic values and the verified public Actions bot identity.
  const staged = git(cwd, "diff", "--cached");
  assert.ok(!staged.includes("Co-authored-by:"));
  git(cwd, "-c", "user.name=github-actions[bot]", "-c", `user.email=${botEmail}`, "commit", "-m", "test fixture");
  assert.equal(git(cwd, "show", "-s", "--format=%ae|%ce", "HEAD"), `${botEmail}|${botEmail}`);
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "webbin-update-test-"));
  try {
    const upstream = join(root, "upstream"), user = join(root, "user");
    mkdirSync(upstream);
    git(upstream, "init", "-b", "main");
    git(upstream, "config", "core.autocrlf", "false");
    put(upstream, "package.json", JSON.stringify({ webbin: { deploymentVersion: 1 } }));
    put(upstream, "index.js", "old app\n");
    put(upstream, "userscript/retired.js", "old file\n");
    put(upstream, "wrangler.toml", "template\n");
    put(upstream, ".github/workflows/update.yml", "old workflow\n");
    put(upstream, ".gitignore", ".dev.vars\n");
    commit(upstream);
    git(root, "-c", "core.autocrlf=false", "clone", "--local", upstream, user);
    git(user, "config", "core.autocrlf", "false");
    put(user, "wrangler.toml", "personal KV binding\n");
    put(user, "personal-notes.md", "keep this\n");
    commit(user);
    put(user, ".dev.vars", "TOKEN=synthetic-local-secret\n");
    return fn({ upstream, user });
  } finally {
    // Verify the exact temporary target before recursive cleanup on Windows.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("webbin-update-test-"));
    rmSync(root, { recursive: true, force: true });
  }
}

test("同步新增/修改/删除的应用文件,保留个人配置、工作流和用户文件", () => fixture(({ upstream, user }) => {
  put(upstream, "index.js", "new app\n");
  put(upstream, "userscript/new.js", "new file\n");
  git(upstream, "rm", "userscript/retired.js");
  put(upstream, "wrangler.toml", "changed template\n");
  put(upstream, ".github/workflows/update.yml", "changed workflow\n");
  commit(upstream);
  put(user, "docs/my-notes.md", "personal notes inside app directory\n");
  commit(user);
  const result = prepareUpdate({ cwd: user, upstream });
  assert.deepEqual(result.changed.sort(), ["index.js", "scripts/upstream-files.json", "userscript/new.js", "userscript/retired.js"]);
  assert.equal(readFileSync(join(user, "wrangler.toml"), "utf8"), "personal KV binding\n");
  assert.equal(readFileSync(join(user, ".github/workflows/update.yml"), "utf8"), "old workflow\n");
  assert.equal(readFileSync(join(user, ".dev.vars"), "utf8"), "TOKEN=synthetic-local-secret\n");
  assert.equal(readFileSync(join(user, "personal-notes.md"), "utf8"), "keep this\n");
  assert.equal(readFileSync(join(user, "docs/my-notes.md"), "utf8"), "personal notes inside app directory\n");
  assert.equal(existsSync(join(user, "userscript/retired.js")), false);
  const before = git(user, "rev-parse", "HEAD");
  commitUpdate({ cwd: user, ...result });
  assert.notEqual(git(user, "rev-parse", "HEAD"), before);
  assert.equal(git(user, "show", "-s", "--format=%ae|%ce", "HEAD"), `${botEmail}|${botEmail}`);
  assert.equal(git(user, "show", "-s", "--format=%P", "HEAD"), before); // single-parent snapshot, no workflow history
  assert.equal(prepareUpdate({ cwd: user, upstream }).changed.length, 0);
}));

test("部署兼容版本变化时在覆盖前停止", () => fixture(({ upstream, user }) => {
  put(upstream, "package.json", JSON.stringify({ webbin: { deploymentVersion: 2 } }));
  put(upstream, "index.js", "incompatible app\n");
  commit(upstream);
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /部署迁移/);
  assert.equal(readFileSync(join(user, "index.js"), "utf8"), "old app\n");
  assert.equal(git(user, "status", "--porcelain"), "");
}));

test("缺少部署契约时停止", () => fixture(({ upstream, user }) => {
  put(upstream, "package.json", "{}\n");
  commit(upstream);
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /缺少部署兼容版本/);
  assert.equal(git(user, "status", "--porcelain"), "");
}));

test("有未提交修改时不覆盖", () => fixture(({ upstream, user }) => {
  put(user, "index.js", "my local changes\n");
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /工作区不干净/);
  assert.equal(readFileSync(join(user, "index.js"), "utf8"), "my local changes\n");
}));

test("拒绝符号链接,避免写到应用目录之外", () => fixture(({ upstream, user }) => {
  const blob = git(upstream, "hash-object", "-w", "--stdin");
  git(upstream, "update-index", "--add", "--cacheinfo", `120000,${blob},userscript/link`);
  commit(upstream, false);
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /符号链接/);
  assert.equal(git(user, "status", "--porcelain"), "");
}));

test("提交前阻止夹带范围以外的配置", () => fixture(({ upstream, user }) => {
  put(upstream, "index.js", "new app\n");
  commit(upstream);
  const result = prepareUpdate({ cwd: user, upstream });
  const before = git(user, "rev-parse", "HEAD");
  put(user, "wrangler.toml", "unexpected staged config\n");
  git(user, "add", "wrangler.toml");
  assert.throws(() => commitUpdate({ cwd: user, ...result }), /暂存范围发生变化/);
  assert.equal(git(user, "rev-parse", "HEAD"), before);
}));

test("方括号按字面匹配，保留相似名称的个人文件", () => fixture(({ upstream, user }) => {
  put(user, "docs/chapter1.md", "personal note\n");
  commit(user);
  put(upstream, "docs/chapter[1].md", "upstream chapter\n");
  commit(upstream);
  const result = prepareUpdate({ cwd: user, upstream });
  assert.deepEqual(result.changed.sort(), ["docs/chapter[1].md", "scripts/upstream-files.json"]);
  commitUpdate({ cwd: user, ...result });
  assert.equal(git(user, "show", "HEAD:docs/chapter1.md"), "personal note");
  assert.equal(git(user, "show", "HEAD:docs/chapter[1].md"), "upstream chapter");
}));

for (const [personal, incoming] of [["docs/chapter", "docs/chapter/new.md"], ["docs/chapter/my-note.md", "docs/chapter"]]) {
  test(`写入前拒绝文件和目录冲突：${personal}`, () => fixture(({ upstream, user }) => {
    put(user, personal, "personal note\n");
    commit(user);
    put(upstream, incoming, "new upstream content\n");
    put(upstream, "index.js", "new app\n");
    commit(upstream);
    assert.throws(() => prepareUpdate({ cwd: user, upstream }), /文件与目录冲突/);
    assert.equal(git(user, "status", "--porcelain"), "");
    assert.equal(readFileSync(join(user, personal), "utf8"), "personal note\n");
  }));
}

test("提交前拒绝同一暂存路径上的内容被替换", () => fixture(({ upstream, user }) => {
  put(upstream, "index.js", "new app\n");
  commit(upstream);
  const result = prepareUpdate({ cwd: user, upstream });
  put(user, "index.js", "different content\n");
  git(user, "add", "index.js");
  assert.throws(() => commitUpdate({ cwd: user, ...result }), /文件内容与预期不符/);
}));

test("发布前发现上游版本变化时停止", () => fixture(({ upstream, user }) => {
  const testedSha = git(upstream, "rev-parse", "HEAD");
  put(upstream, "index.js", "new app\n");
  commit(upstream);
  assert.throws(() => prepareUpdate({ cwd: user, upstream, testedSha }), /测试后有新提交/);
  assert.equal(git(user, "status", "--porcelain"), "");
}));

test("提交前检查暂存邮箱,错误不泄露完整地址", () => fixture(({ upstream, user }) => {
  const synthetic = ["synthetic-person", "private.invalid"].join("@");
  put(upstream, "index.js", `// ${synthetic}\n`);
  commit(upstream);
  const result = prepareUpdate({ cwd: user, upstream });
  const before = git(user, "rev-parse", "HEAD");
  assert.throws(() => commitUpdate({ cwd: user, ...result }), (error) => /邮箱/.test(error.message) && !error.message.includes(synthetic));
  assert.equal(git(user, "rev-parse", "HEAD"), before);
}));

test("合法 npm 包版本不会被误判为邮箱", () => fixture(({ upstream, user }) => {
  put(upstream, "index.js", "// https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0\n");
  commit(upstream);
  const result = prepareUpdate({ cwd: user, upstream });
  assert.doesNotThrow(() => commitUpdate({ cwd: user, ...result }));
}));

test("上游新增文件与个人文件冲突时不覆盖", () => fixture(({ upstream, user }) => {
  put(user, "docs/new.md", "my own note\n");
  commit(user);
  put(upstream, "docs/new.md", "new upstream doc\n");
  commit(upstream);
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /个人文件同名/);
  assert.equal(readFileSync(join(user, "docs/new.md"), "utf8"), "my own note\n");
  assert.equal(git(user, "status", "--porcelain"), "");
}));

test("上游新增文件与被 Git 忽略的个人文件同名时不覆盖", () => fixture(({ upstream, user }) => {
  put(user, ".gitignore", ".dev.vars\ndocs/ignored.md\n");
  commit(user);
  put(user, "docs/ignored.md", "ignored personal note\n");
  put(upstream, "docs/ignored.md", "upstream doc\n");
  commit(upstream);
  assert.equal(git(user, "status", "--porcelain"), "");
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /个人文件同名/);
  assert.equal(readFileSync(join(user, "docs/ignored.md"), "utf8"), "ignored personal note\n");
}));

test("发布清单遗漏新增文件时停止", () => fixture(({ upstream, user }) => {
  put(upstream, "docs/unlisted.md", "new doc\n");
  git(upstream, "add", "docs/unlisted.md");
  commit(upstream, false);
  assert.throws(() => prepareUpdate({ cwd: user, upstream }), /发布文件清单未更新/);
  assert.equal(git(user, "status", "--porcelain"), "");
}));

for (const failBuild of [false, true]) {
  test(failBuild ? "测试失败时用户仓库保持原版本" : "发布从独立检出重建更新，忽略测试目录中的修改", { skip: !process.env.npm_execpath }, () => fixture(({ upstream, user }) => {
    const remote = join(dirname(user), "remote.git");
    git(dirname(user), "-c", "core.autocrlf=false", "clone", "--bare", "--local", user, remote);
    const publish = join(dirname(user), "publish");
    git(dirname(user), "-c", "core.autocrlf=false", "clone", "--local", remote, publish);
    git(publish, "config", "core.autocrlf", "false");
    const before = git(user, "rev-parse", "HEAD");
    put(upstream, "index.js", "new application\n");
    put(upstream, "scripts/build-fixture.cjs", `if (process.env.WEBBIN_PUSH_TOKEN) process.exit(9);\nrequire('node:fs').writeFileSync('index.js', 'modified by tests');\nprocess.exit(${failBuild ? 7 : 0});\n`);
    put(upstream, "package.json", JSON.stringify({ name: "webbin-fixture", webbin: { deploymentVersion: 1 }, scripts: { build: "node scripts/build-fixture.cjs" } }));
    put(upstream, "package-lock.json", JSON.stringify({ name: "webbin-fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "webbin-fixture" } } }));
    commit(upstream);
    const output = join(dirname(user), "prepare-output");
    const env = {
      ...botEnv, GITHUB_REPOSITORY: "fixture/webbin", GITHUB_STEP_SUMMARY: "", GITHUB_OUTPUT: output,
      // Only local fixture transport is used; no request to the real GitHub upstream.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${upstream.replaceAll("\\", "/")}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/MuYukk1/Webbin.git",
    };
    delete env.WEBBIN_PUSH_TOKEN;
    const updater = fileURLToPath(new URL("../scripts/update-webbin.mjs", import.meta.url));
    const run = (cwd, args, childEnv = env) => execFileSync(process.execPath, args, { cwd, stdio: "pipe", env: childEnv });
    run(user, [updater, "prepare"]);
    const sha = git(upstream, "rev-parse", "HEAD");
    assert.equal(readFileSync(output, "utf8").trim(), `sha=${sha}`);
    run(user, [process.env.npm_execpath, "ci", "--no-audit", "--no-fund"]);
    const build = () => run(user, [process.env.npm_execpath, "run", "build"]);
    if (failBuild) {
      assert.throws(build, (error) => error.status === 7);
      assert.equal(git(remote, "rev-parse", "main"), before);
    } else {
      build();
      assert.equal(git(remote, "rev-parse", "main"), before);
      run(publish, [updater, "publish"], { ...env, WEBBIN_TESTED_SHA: sha, WEBBIN_PUSH_TOKEN: "synthetic-token" });
      assert.notEqual(git(remote, "rev-parse", "main"), before);
      assert.equal(git(remote, "show", "main:index.js"), "new application");
      assert.equal(git(remote, "show", "main:wrangler.toml"), "personal KV binding");
    }
    assert.equal(git(user, "rev-parse", "HEAD"), before);
    assert.equal(readFileSync(join(user, "wrangler.toml"), "utf8"), "personal KV binding\n");
    assert.equal(readFileSync(join(user, ".dev.vars"), "utf8"), "TOKEN=synthetic-local-secret\n");
  }));
}
