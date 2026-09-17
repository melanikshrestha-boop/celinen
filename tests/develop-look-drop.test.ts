import { describe, expect, test } from "bun:test";
import { lookDragCount, lookDropFiles } from "../src/components/develop/useLookInspirations";

// Dropping photos on Clicky or the open photo makes them inspirations; every
// other drop (a card of RAWs, a folder, a large batch) must still import.
function transfer(files: { name: string; type: string; size?: number }[]) {
  const real = files.map((f) => new File([new Uint8Array(f.size ?? 8)], f.name, { type: f.type }));
  return {
    items: real.map((file) => ({ kind: "file", type: file.type })),
    files: real,
  } as unknown as DataTransfer;
}

describe("look drop classification", () => {
  test("a few browser-decodable photos are inspirations", () => {
    const drop = transfer([
      { name: "a.jpg", type: "image/jpeg" },
      { name: "b.webp", type: "image/webp" },
    ]);
    expect(lookDragCount(drop, 4)).toBe(2);
    expect(lookDropFiles(drop, 4)?.map((f) => f.name)).toEqual(["a.jpg", "b.webp"]);
  });

  test("RAW files, mixed drops and large batches stay imports", () => {
    const raw = transfer([{ name: "a.arw", type: "" }]);
    expect(lookDragCount(raw, 4)).toBe(0);
    expect(lookDropFiles(raw, 4)).toBeNull();
    const mixed = transfer([
      { name: "a.jpg", type: "image/jpeg" },
      { name: "b.nef", type: "image/x-nikon-nef" },
    ]);
    expect(lookDropFiles(mixed, 4)).toBeNull();
    const card = transfer(
      Array.from({ length: 5 }, (_, i) => ({ name: `${i}.jpg`, type: "image/jpeg" })),
    );
    expect(lookDragCount(card, 4)).toBe(0);
    expect(lookDropFiles(card, 4)).toBeNull();
    expect(lookDropFiles(null, 4)).toBeNull();
  });

  test("an empty file is not an inspiration", () => {
    expect(lookDropFiles(transfer([{ name: "a.jpg", type: "image/jpeg", size: 0 }]), 4)).toBeNull();
  });
});
