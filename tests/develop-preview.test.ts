import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { developEngineStatus } from "../src/lib/develop/client";
import { prepareDevelopPreview } from "../src/lib/develop/preview";
import { prepareDevelopImportPreview } from "../src/lib/develop/import-session";
import type { DevelopPhotoInput } from "../src/lib/develop/store";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalBitmap = globalThis.createImageBitmap;
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
const file = new File(["original-jpeg-bytes"], "_DSC6094.jpg", { type: "image/jpeg" });
const raw = new File(["sensor"], "_DSC6094.NEF");
let statusReady = false;
let renderCalls = 0;
let bitmaps: Blob[] = [];

function statusResponse(): Response {
  return Response.json({
    ready: statusReady,
    token: statusReady ? "token-preview" : null,
    engine: "test-native-develop",
    maxEdge: 4096,
    maxFileBytes: 128 * 1024 * 1024,
    workingSpace: "sRGB",
    rawSupported: statusReady,
  });
}

const input = (isRaw: boolean): DevelopPhotoInput => ({
  id: "sha256:preview-test",
  name: isRaw ? raw.name : file.name,
  width: 0,
  height: 0,
  isRaw,
  sourceBlob: isRaw ? raw : file,
  previewBlob: null,
  sourceFileName: isRaw ? raw.name : file.name,
  sourceLastModified: 1,
  sourceDigest: "sha256:preview-test",
});

beforeEach(async () => {
  statusReady = false;
  renderCalls = 0;
  bitmaps = [];
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname: "127.0.0.1" } },
    configurable: true,
  });
  globalThis.createImageBitmap = (async (source: ImageBitmapSource) => {
    bitmaps.push(source as Blob);
    return { width: 120, height: 80, close() {} } as ImageBitmap;
  }) as typeof createImageBitmap;
  globalThis.fetch = (async (resource: string | URL | Request) => {
    const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
    if (url.includes("/__develop/status") || resource === "/__develop/status") return statusResponse();
    if (url.includes("/__develop/render") || resource === "/__develop/render") {
      renderCalls++;
      return new Response(jpeg, {
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(jpeg.length),
          "x-foto-source": "preview",
        },
      });
    }
    throw new Error(`Unexpected test request ${String(resource)}`);
  }) as typeof fetch;
  await developEngineStatus(true);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.createImageBitmap = originalBitmap;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("Develop JPEG import without the C++ engine", () => {
  test("saves the original JPEG when status is unavailable", async () => {
    const preview = await prepareDevelopPreview(file, { isRaw: false }, new AbortController().signal);
    expect(preview.previewBlob).toBe(file);
    expect(preview.previewOrigin).toBe("raster");
    expect(preview).toMatchObject({ width: 120, height: 80 });
    expect(renderCalls).toBe(0);
    expect(bitmaps).toHaveLength(1);
    const imported = await prepareDevelopImportPreview(
      file,
      input(false),
      new AbortController().signal,
    );
    expect(imported.previewBlob).toBe(file);
    expect(imported.width).toBe(120);
  });

  test("RAW still requires the local engine", async () => {
    await expect(
      prepareDevelopPreview(raw, { isRaw: true }, new AbortController().signal),
    ).rejects.toThrow("local C++ Develop engine is unavailable");
    expect(renderCalls).toBe(0);
  });

  test("JPEG edits use the browser renderer when C++ is down", async () => {
    const { renderDevelop } = await import("../src/lib/develop/client");
    const { defaultDevelopSettings } = await import("../src/lib/develop/contract");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const previousBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = (async () =>
      ({ width: 1, height: 1, close() {} }) as ImageBitmap) as typeof createImageBitmap;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => {
          const pixels = new Uint8ClampedArray([128, 128, 128, 255]);
          return {
            width: 1,
            height: 1,
            getContext: () => ({
              drawImage: () => {},
              getImageData: () => ({ data: pixels }),
              putImageData: () => {},
            }),
            toBlob: (done: (blob: Blob) => void) => done(new Blob([pixels], { type: "image/jpeg" })),
          };
        },
      },
    });
    try {
      const recipe = defaultDevelopSettings();
      recipe.temperature = 18;
      const blob = await renderDevelop(file, recipe);
      expect(blob.type).toBe("image/jpeg");
      expect(renderCalls).toBe(0);
    } finally {
      globalThis.createImageBitmap = previousBitmap;
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  test("uses C++ when the engine is ready", async () => {
    statusReady = true;
    await developEngineStatus(true);
    const preview = await prepareDevelopPreview(file, { isRaw: false }, new AbortController().signal);
    expect(preview.previewBlob).not.toBe(file);
    expect(preview.previewOrigin).toBe("raster");
    expect(renderCalls).toBe(1);
  });
});

describe("Develop light chrome", () => {
  test("import report and empty stage use tokens, not a hardcoded darkroom", () => {
    const sheet = readFileSync(
      new URL("../src/components/develop/develop.css", import.meta.url),
      "utf8",
    );
    expect(sheet).toMatch(/\.foto-develop \{\n  --dv-bg: #ffffff;/);
    expect(sheet).toMatch(/html\.dark \.foto-develop \{\n  --dv-bg: #202020;/);
    expect(sheet).toMatch(/\.develop-import-report \{\n  padding: 6px 14px;\n  background: var\(--dv-panel\);/);
    expect(sheet).toMatch(
      /\.develop-workspace\.is-without-photo \{\n  grid-template-columns: minmax\(0, 1fr\);\n  background: var\(--dv-bg\);/,
    );
    expect(sheet).not.toMatch(/\.develop-import-report \{[^}]*background: #292929;/s);
  });
});
