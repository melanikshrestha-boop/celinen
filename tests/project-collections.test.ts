import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readProjectCollections, writeProjectCollections } from "../src/lib/projects/collections";

test("project collections default to Favorites and persist", () => {
  const store = new Map<string, string>();
  // defineProperty, not assignment: bun runs every file in one process, and a
  // sibling that installed a non-writable localStorage makes assignment throw.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  const first = readProjectCollections();
  expect(first[0]?.id).toBe("favorites");
  writeProjectCollections([
    ...first,
    { id: "weddings", title: "Weddings", projectIds: ["a"] },
  ]);
  expect(readProjectCollections().some((row) => row.id === "weddings")).toBe(true);
});

test("projects library uses collection and import tiles", () => {
  const source = readFileSync(new URL("../src/routes/projects.tsx", import.meta.url), "utf8");
  const css = readFileSync(
    new URL("../src/components/projects/projects-library.css", import.meta.url),
    "utf8",
  );
  expect(source).toContain("celinen-projects");
  expect(source).toContain("Import shoot");
  expect(source).toContain("Add collection");
  expect(css).toContain("celinen-projects__grid");
});
