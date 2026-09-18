import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateIngestWasm } from "../src/lib/studio/cull/ingest-engine";
import {
  faceFromAf,
  findPortraitFace,
  findPortraitFaceOriented,
  loupeFaceCrop,
} from "../src/lib/studio/cull/portrait-face";

function canvas(w: number, h: number, fill: [number, number, number]) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = fill[0];
    rgba[i * 4 + 1] = fill[1];
    rgba[i * 4 + 2] = fill[2];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, w, h };
}

function oval(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: [number, number, number],
) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w - cx;
      const dy = (y + 0.5) / h - cy;
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
        const i = (y * w + x) * 4;
        rgba[i] = rgb[0];
        rgba[i + 1] = rgb[1];
        rgba[i + 2] = rgb[2];
      }
    }
  }
}

test("a skin-colored head in a street frame is a face", () => {
  const { rgba, w, h } = canvas(160, 100, [40, 50, 55]);
  oval(rgba, w, h, 0.32, 0.42, 0.12, 0.18, [180, 120, 95]);
  const face = findPortraitFace(rgba, w, h);
  expect(face).not.toBeNull();
  expect(face!.x).toBeLessThan(0.32);
  expect(face!.x + face!.width).toBeGreaterThan(0.32);
  expect(face!.y).toBeLessThan(0.42);
  expect(face!.y + face!.height).toBeGreaterThan(0.42);
});

test("a gray detailed frame is not a face", () => {
  const { rgba, w, h } = canvas(160, 100, [128, 128, 128]);
  expect(findPortraitFace(rgba, w, h)).toBeNull();
});

test("a tungsten night face is still a face", () => {
  const { rgba, w, h } = canvas(160, 100, [28, 30, 38]);
  oval(rgba, w, h, 0.34, 0.4, 0.11, 0.17, [92, 58, 46]);
  expect(findPortraitFace(rgba, w, h)).not.toBeNull();
});

test("a sideways RAW still yields a face box", () => {
  const { rgba, w, h } = canvas(100, 160, [30, 32, 40]);
  oval(rgba, w, h, 0.5, 0.38, 0.16, 0.12, [175, 118, 92]);
  const found = findPortraitFaceOriented(rgba, w, h);
  expect(found).not.toBeNull();
});

test("the loupe crop tightens around a found face", () => {
  const crop = loupeFaceCrop({ x: 0.2, y: 0.25, width: 0.2, height: 0.3 }, true, 1600, 1080);
  expect(crop).not.toBeNull();
  expect(crop!.w).toBeLessThan(1600);
  expect(crop!.h).toBeLessThan(1080);
  expect(crop!.x).toBeGreaterThanOrEqual(0);
  expect(crop!.y).toBeGreaterThanOrEqual(0);
});

test("a dark-skinned head at night is still a face", () => {
  const { rgba, w, h } = canvas(160, 100, [22, 24, 32]);
  oval(rgba, w, h, 0.36, 0.4, 0.12, 0.18, [68, 42, 32]);
  expect(findPortraitFace(rgba, w, h)).not.toBeNull();
});

test("camera AF on a person is a face when chroma is a mess", () => {
  const { rgba, w, h } = canvas(160, 100, [40, 48, 70]);
  const found = findPortraitFaceOriented(rgba, w, h, { x: 0.4, y: 0.32, w: 0.06, h: 0.05 });
  expect(found).not.toBeNull();
  expect(found!.box.x).toBeLessThan(0.45);
  expect(found!.box.x + found!.box.width).toBeGreaterThan(0.4);
});

test("a tiny AF box expands to a head", () => {
  const box = faceFromAf({ x: 0.46, y: 0.38, w: 0.04, h: 0.03 });
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0.08);
  expect(box!.height).toBeGreaterThan(0.1);
});

test("a real portrait photograph has a face", async () => {
  const wasm = await instantiateIngestWasm(
    readFileSync(new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url)),
  );
  const jpeg = readFileSync(new URL("./fixtures/photos/volleyball-portrait-cc0.jpg", import.meta.url));
  const read = wasm.read(new Uint8Array(jpeg));
  const found = findPortraitFaceOriented(
    read.frame.rgba,
    read.frame.width,
    read.frame.height,
    read.afPoint,
  );
  expect(found).not.toBeNull();
  expect(found!.box.width).toBeGreaterThan(0.04);
  expect(found!.box.height).toBeGreaterThan(0.04);
});
