import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
describe("owned OAuth session installation boundary", () => {
  test("owned helper and actual Google consumer fail closed until verified installation", () => {
    const result = Bun.spawnSync(
      [process.execPath, fileURLToPath(new URL("./auth-oauth.fixture.ts", import.meta.url))],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("AUTH_OAUTH_OK");
  });
});
