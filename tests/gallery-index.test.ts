import { expect, test } from "bun:test";
import {
  decodeGalleryIndex,
  encodeGalleryIndex,
  galleryStem,
  indexGalleryHeartsLocal,
} from "../src/lib/gallery-index";

test("gallery hearts stay in photo order and match edited stems", () => {
  expect(galleryStem("DSC_001.ARW")).toBe("dsc_001");
  const result = indexGalleryHeartsLocal({
    photos: [
      { id: "a", name: "DSC_001.ARW" },
      { id: "b", name: "DSC_002.ARW" },
      { id: "c", name: "DSC_003.CR3" },
    ],
    hearts: ["c", "a", "a", "missing"],
    edited: ["dsc_001.jpg", "extra.tif"],
  });
  expect(result.favorites).toEqual(["a", "c"]);
  expect(result.matches).toEqual([{ photoId: "a", editedName: "dsc_001.jpg" }]);
  expect(result.missing).toEqual(["c"]);
});

test("gallery index packet round-trips the C++ request magic", () => {
  const request = {
    photos: [{ id: "keep", name: "Keep.JPG" }],
    hearts: ["keep"],
    edited: ["keep.tif"],
  };
  const packet = encodeGalleryIndex(request);
  expect(packet[0]).toBe(0x47);
  expect(indexGalleryHeartsLocal(request).matches[0]?.editedName).toBe("keep.tif");
  const local = indexGalleryHeartsLocal(request);
  expect(local.favorites).toEqual(["keep"]);
  expect(() => decodeGalleryIndex(packet)).toThrow();
});
