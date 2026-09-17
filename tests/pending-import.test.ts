import { expect, test } from "bun:test";
import {
  hasDevelopImport,
  queueDevelopImport,
  takeDevelopImport,
} from "../src/lib/studio/pending-import";

test("snapshotPhotoFile copies bytes so Develop does not depend on a live picker", async () => {
  const { snapshotPhotoFile } = await import("../src/lib/studio/pending-import");
  const original = new File([new Uint8Array([1, 2, 3, 4])], "frame.jpg", { type: "image/jpeg" });
  const copy = await snapshotPhotoFile(original);
  expect(copy).not.toBe(original);
  expect(copy.name).toBe("frame.jpg");
  expect(copy.size).toBe(4);
  expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
});

test("cull keepers queue into Develop once", () => {
  const a = new File(["a"], "a.arw");
  const b = new File(["b"], "b.arw");
  queueDevelopImport([a, b]);
  expect(hasDevelopImport()).toBe(true);
  expect(takeDevelopImport().map((file) => file.name)).toEqual(["a.arw", "b.arw"]);
  expect(takeDevelopImport()).toEqual([]);
  expect(hasDevelopImport()).toBe(false);
});
