import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DevelopPhotoInput } from "../src/lib/develop/store";
import type { NativeAnalysisPreview } from "../src/lib/studio/native-client";

// Execute the real preparation function without global module mocks or native/customer I/O.
const source = readFileSync(
  new URL("../src/lib/develop/import-session.ts", import.meta.url),
  "utf8",
);
const from = source.indexOf("export async function prepareDevelopImportPreview(");
const to = source.indexOf("async function browserImportLock(", from);
if (from < 0 || to < 0) throw new Error("Import preview boundary missing");
const body = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.slice(from, to).replace("export async function", "async function"),
);
const namespace = JSON.stringify(["synthetic-account", "synthetic-shoot"]);
const original = new File(["immutable synthetic raw"], "reserved.ARW");
const input: DevelopPhotoInput = {
  id: `sha256:${"a".repeat(64)}`,
  sourceDigest: `sha256:${"a".repeat(64)}`,
  name: original.name,
  sourceFileName: original.name,
  sourceLastModified: original.lastModified,
  sourceBlob: original,
  previewBlob: null,
  width: 0,
  height: 0,
  isRaw: true,
};
const native = (
  previewOrigin: NativeAnalysisPreview["previewOrigin"] = "embedded_raw_jpeg",
): NativeAnalysisPreview => ({
  width: 960,
  height: 640,
  sourceWidth: 6000,
  sourceHeight: 4000,
  previewBlob: new Blob(["synthetic native jpeg"], { type: "image/jpeg" }),
  backend: "native-cpp",
  nativeCached: false,
  nativeEngineVersion: "lenslabs-cpp-0.1",
  previewOrigin,
  faceDetectionAvailable: false,
  analysis: {
    sharpness: 150,
    brightness: 120,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "01".repeat(32),
    tone: { black: 0, white: 255, median: 120, rMean: 120, gMean: 120, bMean: 120, satMean: 0.2 },
  },
});
function fixture(result: NativeAnalysisPreview | null | Error, afterNative?: () => void) {
  let nativeCalls = 0,
    fullDevelopCalls = 0;
  const prepare = new Function(
    "analyseFileNative",
    "prepareDevelopPreview",
    "developAnalysisReceiptSchema",
    body + "\nreturn prepareDevelopImportPreview;",
  )(
    async (file: File) => {
      expect(file).toBe(original);
      nativeCalls++;
      afterNative?.();
      if (result instanceof Error) throw result;
      return result;
    },
    async () => {
      fullDevelopCalls++;
      return {
        previewBlob: new Blob(["full fallback"]),
        previewOrigin: "raw-demosaic",
        width: 12,
        height: 8,
      };
    },
    // Receipt validation/persistence has separate actual-store tests. This boundary checks routing.
    { parse: (value: unknown) => value },
  ) as (
    file: File,
    input: DevelopPhotoInput,
    signal: AbortSignal,
    context: { namespace: string },
  ) => Promise<DevelopPhotoInput>;
  return {
    prepare,
    get calls() {
      return { native: nativeCalls, fullDevelop: fullDevelopCalls };
    },
  };
}

describe("import reuses native embedded preview and quality measurements", () => {
  test("one cheap native result supplies preview and source-bound mechanical receipt, not a full Develop render", async () => {
    const result = native();
    const f = fixture(result);
    const prepared = await f.prepare(original, input, new AbortController().signal, { namespace });
    expect(f.calls).toEqual({ native: 1, fullDevelop: 0 });
    expect(prepared.sourceBlob).toBe(original);
    expect(prepared.id).toBe(input.id);
    expect(prepared.sourceDigest).toBe(input.sourceDigest);
    expect(prepared.previewBlob).toBe(result.previewBlob);
    expect(prepared.previewOrigin).toBe("embedded");
    expect(prepared.analysis).toMatchObject({
      version: 1,
      kind: "mechanical",
      namespace,
      photoId: input.id,
      sourceDigest: input.sourceDigest,
      representation: "embedded-preview",
      engine: { name: "native-cpp", version: "lenslabs-cpp-0.1" },
      width: 960,
      height: 640,
      analysis: result.analysis,
    });
  });

  test("an older engine retains its measured result with explicit unknown origin, without another render", async () => {
    const f = fixture(native("unknown"));
    const prepared = await f.prepare(original, input, new AbortController().signal, { namespace });
    expect(f.calls).toEqual({ native: 1, fullDevelop: 0 });
    expect(prepared.previewOrigin).toBe("unknown");
    expect(prepared.analysis).toMatchObject({
      sourceDigest: input.sourceDigest,
      representation: "unknown-preview",
      engine: { name: "native-cpp", version: "lenslabs-cpp-0.1" },
    });
  });

  test("only an unavailable native engine uses the existing full Develop fallback", async () => {
    const f = fixture(null);
    const prepared = await f.prepare(original, input, new AbortController().signal, { namespace });
    expect(f.calls).toEqual({ native: 1, fullDevelop: 1 });
    expect(prepared.previewOrigin).toBe("raw-demosaic");
    expect(prepared.analysis).toBeUndefined();
    const failed = fixture(new Error("native decode failed"));
    await expect(
      failed.prepare(original, input, new AbortController().signal, { namespace }),
    ).rejects.toThrow("native decode failed");
    expect(failed.calls).toEqual({ native: 1, fullDevelop: 0 });
  });

  test("a late result after cancellation cannot be saved or start full Develop fallback", async () => {
    const controller = new AbortController();
    const f = fixture(native(), () => controller.abort());
    await expect(f.prepare(original, input, controller.signal, { namespace })).rejects.toThrow();
    expect(f.calls).toEqual({ native: 1, fullDevelop: 0 });
  });
});
