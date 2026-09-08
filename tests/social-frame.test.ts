import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SOCIAL_FRAME, socialFrameSchema } from "../src/lib/social-frame";
import { runNativeSocial, socialArguments } from "../src/server/native-social";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";

describe("social framing boundary", () => {
  test("accepts only bounded controls and keeps platform dimensions constrained", () => {
    for (const format of ["portrait", "square", "story"] as const)
      for (const mode of ["fit", "fill"] as const) {
        expect(socialFrameSchema.safeParse({ ...DEFAULT_SOCIAL_FRAME, format, mode }).success).toBe(
          true,
        );
      }
    for (const patch of [
      { x: -1 },
      { y: 2 },
      { zoom: NaN },
      { zoom: Infinity },
      { zoom: 4 },
      { mode: "fit", zoom: 2 },
      { format: "path" },
      { background: "url(https://example.test)" },
      { source: "/private/file" },
    ]) {
      expect(socialFrameSchema.safeParse({ ...DEFAULT_SOCIAL_FRAME, ...patch }).success).toBe(
        false,
      );
    }
    expect(socialArguments("/private/temp/source", DEFAULT_SOCIAL_FRAME)).toEqual([
      "/private/temp/source",
      "story",
      "fit",
      "0.5",
      "0.5",
      "1",
      "black",
    ]);
  });
});
describe.skipIf(process.platform !== "darwin")("real C++ social JPEG operator", () => {
  const binary = resolve("native/build/lenslabs-social"),
    source = resolve("tests/fixtures/photos/basketball-action-usaf-pd.jpg");
  test("exports exact dimensions and leaves the source bytes unchanged", async () => {
    const before = readFileSync(source);
    for (const [format, height] of [
      ["story", 1920],
      ["portrait", 1350],
      ["square", 1080],
    ] as const) {
      const output = await runNativeSocial(
        binary,
        source,
        { ...DEFAULT_SOCIAL_FRAME, format },
        new AbortController().signal,
      );
      expect(jpegDimensions(output)).toEqual({ width: 1080, height });
      expect(output.length).toBeLessThan(8 * 1024 * 1024);
    }
    expect(readFileSync(source)).toEqual(before);
  });
  test("fill positioning and zoom produce distinct real JPEGs", async () => {
    const left = await runNativeSocial(
      binary,
      source,
      { ...DEFAULT_SOCIAL_FRAME, mode: "fill", x: 0, zoom: 2 },
      new AbortController().signal,
    );
    const right = await runNativeSocial(
      binary,
      source,
      { ...DEFAULT_SOCIAL_FRAME, mode: "fill", x: 1, zoom: 2 },
      new AbortController().signal,
    );
    expect(left.equals(right)).toBe(false);
  });
  test("cancel, missing executable, corrupt image and invalid recipe fail explicitly", async () => {
    const cancel = new AbortController();
    cancel.abort();
    await expect(
      runNativeSocial(binary, source, DEFAULT_SOCIAL_FRAME, cancel.signal),
    ).rejects.toThrow("cancelled");
    await expect(
      runNativeSocial(
        "/nonexistent/lenslabs-social",
        source,
        DEFAULT_SOCIAL_FRAME,
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not start");
    await expect(
      runNativeSocial(
        binary,
        resolve("package.json"),
        DEFAULT_SOCIAL_FRAME,
        new AbortController().signal,
      ),
    ).rejects.toThrow("rejected");
    await expect(
      runNativeSocial(
        binary,
        source,
        { ...DEFAULT_SOCIAL_FRAME, x: 2 },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});
