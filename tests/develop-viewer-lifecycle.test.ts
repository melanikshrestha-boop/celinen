import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("actual Viewer effects reject stale pixel results and keep image onLoad lightweight", async () => {
  // React/module mocks live only in the child, never Bun's shared test-process cache.
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-viewer-lifecycle.fixture.ts", import.meta.url)),
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
  const result = JSON.parse(output);
  expect(result.passed).toBeGreaterThanOrEqual(58);
  expect(result.groups).toEqual([
    "late source result",
    "URL and error ownership",
    "blob identity",
    "current known histogram props",
    "lightweight image onLoad",
    "before preview provenance",
    "clipping requires matching loaded geometry",
    "clipping cancellation and URL/flag ownership",
    "pixel sampling gates use current image",
    "unmount cleanup",
    "empty and cleared preview",
  ]);
});
