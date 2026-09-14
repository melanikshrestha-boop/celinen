import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read from the checkout being compiled, never from client input or runtime secrets.
export function readBuildInfo(root: string) {
  const git_sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(git_sha)) throw new Error("A Git checkout is required for release provenance.");
  const app_version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
  if (typeof app_version !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(app_version))
    throw new Error("Invalid application version.");
  return { git_sha, build_time: new Date().toISOString(), app_version };
}
