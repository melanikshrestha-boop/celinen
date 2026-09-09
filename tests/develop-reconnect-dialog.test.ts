import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("reconnect review bounds rows, preserves explicit selection, and owns asynchronous receipts", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-reconnect-dialog.fixture.ts", import.meta.url)),
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output).checks).toBeGreaterThanOrEqual(35);
});
