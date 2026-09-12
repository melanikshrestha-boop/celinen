import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  isPoseBoardId,
  parsePinterestBoard,
  POSE_BOARDS,
  POSES,
  readShootPoseLinks,
  writeShootPoseLinks,
} from "../src/lib/poses";

test("built-in pose boards cover standing through park", () => {
  expect(POSE_BOARDS.map((board) => board.id)).toEqual([
    "standing",
    "walk",
    "sit",
    "couple",
    "sun",
    "park",
  ]);
  expect(POSES.every((pose) => isPoseBoardId(pose.board))).toBe(true);
  expect(new Set(POSES.map((pose) => pose.id)).size).toBe(POSES.length);
});

test("Pinterest board links accept official hosts and reject junk", () => {
  expect(parsePinterestBoard("https://www.pinterest.com/melani/central-park/")).toEqual({
    href: "https://www.pinterest.com/melani/central-park/",
    label: "central park",
  });
  expect(parsePinterestBoard("pinterest.com/you/hard-sun")).toEqual({
    href: "https://www.pinterest.com/you/hard-sun/",
    label: "hard sun",
  });
  expect(parsePinterestBoard("https://pin.it/Ab12Cd")).toEqual({
    href: "https://pin.it/Ab12Cd",
    label: "Pinterest",
  });
  expect(parsePinterestBoard("https://evil.com/pinterest.com/x/y")).toBeNull();
  expect(parsePinterestBoard("https://www.pinterest.com/pin/123")).toBeNull();
  expect(parsePinterestBoard("javascript:alert(1)")).toBeNull();
});

test("per-shoot pose links persist boards and a Pinterest URL", () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  const key = "celinen.poses.links.v1:test-scope";
  localStorage.removeItem(key);
  writeShootPoseLinks("test-scope", {
    "11111111-1111-4111-8111-111111111111": {
      pinterest: "https://www.pinterest.com/you/park/",
      boards: ["park", "sun", "park"],
    },
  });
  expect(readShootPoseLinks("test-scope")).toEqual({
    "11111111-1111-4111-8111-111111111111": {
      pinterest: "https://www.pinterest.com/you/park/",
      boards: ["park", "sun"],
    },
  });
  localStorage.removeItem(key);
});

test("poses desk is a dashboard tool with no OAuth claim", () => {
  const page = readFileSync(new URL("../src/components/dashboard/Poses.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/routes/poses.tsx", import.meta.url), "utf8");
  const workbench = readFileSync(new URL("../src/lib/workbench.ts", import.meta.url), "utf8");
  expect(route).toContain('createFileRoute("/poses")');
  expect(workbench).toContain('"/poses"');
  expect(page).toContain("pinterest.com/you/board");
  expect(page).toContain('BrandMark id="pinterest"');
  expect(page).not.toContain("OAuth");
  expect(page).not.toContain("connected");
});
