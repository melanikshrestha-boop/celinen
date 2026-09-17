import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Develop's Cull button opens the cull screen, not Home", () => {
  const develop = read("../src/components/develop/DevelopPage.tsx");
  expect(develop).toContain('else void navigate({ to: "/cull" });');
});

test("the cull screen starts ingesting photos queued from Home", () => {
  const cull = read("../src/routes/cull.tsx");
  expect(cull).toContain("takeStudioImport()");
  expect(cull).toContain(".importCard(importName(queued), queued)");
});
