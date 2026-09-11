import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("native Develop retains exclusive ownership until actual child close", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-process-lifecycle.fixture.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(20);
});
