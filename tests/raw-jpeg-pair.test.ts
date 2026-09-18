import { describe, expect, test } from "bun:test";
import {
  companionPhotoId,
  findRawJpegPairs,
  pairStem,
  resolveRawJpegSwitch,
  switchTargetForPhoto,
  type RawJpegPairable,
} from "@/lib/develop/raw-jpeg-pair";

const photo = (
  id: string,
  name: string,
  isRaw: boolean,
  sourceFileName?: string,
): RawJpegPairable => ({ id, name, isRaw, sourceFileName: sourceFileName ?? name });

describe("raw-jpeg-pair", () => {
  test("pairs same-stem RAW and JPEG from source filenames", () => {
    const photos = [
      photo("r1", "Game 1", true, "DSC_1001.NEF"),
      photo("j1", "Game 1", false, "DSC_1001.JPG"),
      photo("solo", "Other", false, "DSC_1002.JPG"),
    ];
    expect(findRawJpegPairs(photos)).toEqual([
      { stem: "dsc_1001", rawId: "r1", jpegId: "j1" },
    ]);
    expect(companionPhotoId("r1", photos)).toBe("j1");
    expect(companionPhotoId("j1", photos)).toBe("r1");
    expect(companionPhotoId("solo", photos)).toBeNull();
  });

  test("falls back to display name when sourceFileName is missing", () => {
    expect(pairStem(photo("a", "IMG_9.ARW", true, ""))).toBe("img_9");
    const photos = [photo("r", "IMG_9.ARW", true, ""), photo("j", "IMG_9.jpg", false, "")];
    expect(findRawJpegPairs(photos)[0]).toMatchObject({ rawId: "r", jpegId: "j" });
  });

  test("skips ambiguous stems with two JPEGs or two RAWs", () => {
    const photos = [
      photo("r1", "x.NEF", true),
      photo("j1", "x.JPG", false),
      photo("j2", "x.JPEG", false),
    ];
    expect(findRawJpegPairs(photos)).toEqual([]);
  });

  test("resolveRawJpegSwitch selects the requested half", () => {
    const photos = [photo("r", "a.NEF", true), photo("j", "a.JPG", false)];
    expect(switchTargetForPhoto(photos[0]!, photos)).toBe("raw");
    expect(switchTargetForPhoto(photos[1]!, photos)).toBe("jpeg");
    expect(resolveRawJpegSwitch("r", "jpeg", photos)).toBe("j");
    expect(resolveRawJpegSwitch("j", "raw", photos)).toBe("r");
    expect(resolveRawJpegSwitch("solo", "raw", [photo("solo", "z.JPG", false)])).toBe("solo");
  });
});
