// 维护者新增/删除应用文件后执行 npm run manifest,将结果一起提交。
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { isManaged } from "./update-webbin.mjs";

const paths = execFileSync("git", ["ls-files", "-z", "--cached"], { encoding: "utf8" })
  .split("\0").filter(Boolean).filter(isManaged).filter(existsSync);
const files = [...new Set([...paths, "scripts/upstream-files.json"])].sort();
writeFileSync("scripts/upstream-files.json", JSON.stringify(files, null, 2) + "\n");
console.log(`发布文件清单已更新: ${files.length} 个文件。`);
