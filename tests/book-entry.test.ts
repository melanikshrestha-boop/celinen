import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("starting a shoot is not an intake form", () => {
  const source = readFileSync(new URL("../src/routes/book.tsx", import.meta.url), "utf8");
  expect(source).toContain('redirect({ to: "/shoots" })');
  expect(source).not.toContain("createShootRequest");
  expect(source).not.toContain("Your name");
  expect(source).not.toContain("Create shoot");
  expect(source).not.toContain("<form");
  expect(source).not.toContain("Brief");
  expect(source).not.toContain("Budget");
});
