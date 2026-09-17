import { expect, test } from "bun:test";
import {
  hasDevelopImport,
  queueDevelopImport,
  takeDevelopImport,
} from "../src/lib/studio/pending-import";

test("cull keepers queue into Develop once", () => {
  const a = new File(["a"], "a.arw");
  const b = new File(["b"], "b.arw");
  queueDevelopImport([a, b]);
  expect(hasDevelopImport()).toBe(true);
  expect(takeDevelopImport().map((file) => file.name)).toEqual(["a.arw", "b.arw"]);
  expect(takeDevelopImport()).toEqual([]);
  expect(hasDevelopImport()).toBe(false);
});
