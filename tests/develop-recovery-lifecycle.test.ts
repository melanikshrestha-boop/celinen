import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the first file result survives an event before passive mount effects", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-recovery-lifecycle.fixture.ts", import.meta.url)),
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(exitCode).toBe(0);
  const result = JSON.parse(output);
  expect(result.error).toContain("different workspace or project");
  expect(result.libraryReads).toBe(0);
  expect(result.busy).toEqual([true, false]);
});
