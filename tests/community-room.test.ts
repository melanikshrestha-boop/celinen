import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/routes/community.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../src/components/community/community-room.css", import.meta.url),
  "utf8",
);

test("community room drops rust, blue rings, and workbench chrome", () => {
  expect(page).not.toMatch(/bg-rust|text-rust|focus:border-rust|accent-rust/);
  expect(page).toContain("community-page");
  expect(page).toContain("Claim your handle");
  expect(page).toContain("Join the room");
  expect(css).toContain("background: #fff");
  expect(css).toContain("background: #111");
  expect(css).not.toMatch(/#005888|#1959d1|#2458d6|#3b82f6|#006eaa|--rust|bg-rust|#e11/i);
  expect(css).toContain("border-color: #111");
});
