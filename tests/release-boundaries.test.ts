import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Each child owns its module mocks. They cannot replace Auth, routing, or spawn
// for another test file when Bun runs the complete repository suite.
for (const boundary of ["native", "lightroom", "profile"] as const)
  test(`isolated ${boundary} production-boundary regressions`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/release-boundaries.ts", import.meta.url)), boundary],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^PASS ${boundary}: \\d+ assertions\\n$`));
    console.log(result.stdout.trim());
  });
