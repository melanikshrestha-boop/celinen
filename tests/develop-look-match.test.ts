import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  type DevelopSettings,
} from "../src/lib/develop/contract";
import {
  isLookDescriptor,
  LOOK_DESCRIPTOR_SIZE,
  LOOK_RESULT_SIZE,
  LOOK_SOURCE_EDGE,
  lookChangedControls,
  lookMatchResult,
  type LookDescriptor,
} from "../src/lib/develop/look-match";
import { instantiateDevelopWasm, type DevelopWasmEngine } from "../src/lib/develop/wasm/engine";
import { instantiateIngestWasm } from "../src/lib/studio/cull/ingest-engine";

// Match a look, proven on the real fixture photographs through the committed
// WebAssembly: the exact bytes lenslab.dev serves. An inspiration is rendered
// from a known random recipe; the neutral original and exposure/white balance
// shifted copies are matched and must land on the inspiration's look.
const FIXTURES = [
  "volleyball-portrait-cc0.jpg",
  "basketball-hangar-usnavy-pd.jpg",
  "basketball-action-usaf-pd.jpg",
] as const;
type Frame = { width: number; height: number; rgba: Uint8ClampedArray };

let engine: DevelopWasmEngine;
const frames = new Map<string, Frame>();
beforeAll(async () => {
  engine = await instantiateDevelopWasm(
    readFileSync(new URL("../src/lib/develop/wasm/celinen-develop.wasm", import.meta.url)),
  );
  // The same 1024 px upright decode the page hands the engine.
  const ingest = await instantiateIngestWasm(
    readFileSync(new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url)),
  );
  for (const name of FIXTURES) {
    const bytes = new Uint8Array(
      readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)),
    );
    frames.set(name, ingest.read(bytes, { measureEdge: LOOK_SOURCE_EDGE }).frame);
  }
});

function load(frame: Frame) {
  engine.source(frame.width, frame.height).set(frame.rgba);
}
function render(frame: Frame, settings: DevelopSettings): Frame {
  load(frame);
  return engine.develop(settings);
}
function describeFrame(frame: Frame): LookDescriptor {
  load(frame);
  return engine.describeLook();
}

// Deterministic random looks across tone, curve, HSL, grading, fade and
// vignette, in the ranges real looks use.
function looks(seed: number) {
  let state = BigInt(seed);
  const next = () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number(state >> 11n) / 2 ** 53;
  };
  const range = (low: number, high: number) => Math.round(low + (high - low) * next());
  return () => {
    const s = defaultDevelopSettings();
    Object.assign(s, {
      contrast: range(-30, 40),
      highlights: range(-50, 30),
      shadows: range(-30, 50),
      whites: range(-30, 30),
      blacks: range(-30, 30),
      temperature: range(-20, 20),
      tint: range(-10, 10),
      saturation: range(-30, 25),
      vibrance: range(-20, 30),
      fade: range(0, 30),
      vignette: range(-40, 15),
    });
    s.curve = [
      { x: 0, y: range(0, 8) / 100 },
      { x: 0.5, y: range(42, 58) / 100 },
      { x: 1, y: range(92, 100) / 100 },
    ];
    s.hsl = s.hsl.map(() => ({
      hue: range(-25, 25),
      saturation: range(-40, 40),
      luminance: range(-25, 25),
    }));
    s.grading.shadows = { hue: range(0, 359), saturation: range(0, 35), luminance: 0 };
    s.grading.midtones = { hue: range(0, 359), saturation: range(0, 12), luminance: 0 };
    s.grading.highlights = { hue: range(0, 359), saturation: range(0, 30), luminance: 0 };
    return developSettingsSchema.parse(s);
  };
}

// native look_match.hpp serialization offsets.
const QUANTILES = 2,
  ZONES = 15,
  BANDS = 42;
const zone = (d: LookDescriptor, z: number) => ({
  fraction: d[ZONES + z * 9]!,
  l: d[ZONES + z * 9 + 1]!,
  a: d[ZONES + z * 9 + 2]!,
  b: d[ZONES + z * 9 + 3]!,
});
const band = (d: LookDescriptor, i: number) => ({
  mass: d[BANDS + i * 5]!,
  saturation: d[BANDS + i * 5 + 1]!,
  lightness: d[BANDS + i * 5 + 2]!,
});

// CIEDE2000 (Sharma, Wu, Dalal 2005).
function deltaE2000(l1: number, a1: number, b1: number, l2: number, a2: number, b2: number) {
  const rad = Math.PI / 180;
  const c7 = ((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(c7 / (c7 + 25 ** 7)));
  const a1p = (1 + g) * a1,
    a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1),
    c2p = Math.hypot(a2p, b2);
  const angle = (b: number, a: number) =>
    a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360;
  const h1p = angle(b1, a1p),
    h2p = angle(b2, a2p);
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = l2 - l1,
    dC = c2p - c1p,
    dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh / 2) * rad);
  const lm = (l1 + l2) / 2,
    cm = (c1p + c2p) / 2;
  let hm = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hm += hm < 360 ? 360 : -360;
    hm /= 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const theta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2);
  const sc = 1 + 0.045 * cm,
    sh = 1 + 0.015 * cm * t,
    rt = -Math.sin(2 * theta * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

type Accuracy = {
  zoneMean: number;
  zoneMax: number;
  quantileMax: number;
  bandSaturation: number;
  bandLightness: number;
};
/** Zone color error: CIEDE2000 between zone mean colors, averaged by the look's
 * pixel share; zoneMax is the worst zone holding at least 10% of the frame. */
function accuracy(got: LookDescriptor, want: LookDescriptor): Accuracy {
  let zoneMean = 0,
    share = 0,
    zoneMax = 0,
    quantileMax = 0,
    bandSaturation = 0,
    bandLightness = 0;
  for (let z = 0; z < 3; z++) {
    const g = zone(got, z),
      w = zone(want, z);
    const e = deltaE2000(g.l, g.a, g.b, w.l, w.a, w.b);
    zoneMean += e * w.fraction;
    share += w.fraction;
    if (w.fraction >= 0.1) zoneMax = Math.max(zoneMax, e);
  }
  for (let q = 0; q < 13; q++)
    quantileMax = Math.max(quantileMax, Math.abs(got[QUANTILES + q]! - want[QUANTILES + q]!));
  for (let i = 0; i < 8; i++) {
    const g = band(got, i),
      w = band(want, i);
    if (Math.min(g.mass, w.mass) <= 0.01) continue;
    bandSaturation = Math.max(bandSaturation, Math.abs(g.saturation - w.saturation));
    bandLightness = Math.max(bandLightness, Math.abs(g.lightness - w.lightness));
  }
  return { zoneMean: zoneMean / share, zoneMax, quantileMax, bandSaturation, bandLightness };
}
const worst = (all: Accuracy[]) =>
  Object.fromEntries(
    (Object.keys(all[0]!) as (keyof Accuracy)[]).map((key) => [
      key,
      Math.max(...all.map((a) => a[key])),
    ]),
  ) as Accuracy;
const fixed = (a: Accuracy) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Number(v.toFixed(3))]));

describe("Match a look on real photographs (committed WebAssembly)", () => {
  test("the neutral original and ±1.5 EV / ±30 temperature copies land on the inspiration", () => {
    const next = looks(20260917);
    const unclipped: Accuracy[] = [];
    const clipped: Accuracy[] = [];
    const times: number[] = [];
    for (const name of FIXTURES) {
      const photo = frames.get(name)!;
      for (let trial = 0; trial < 2; trial++) {
        const look = describeFrame(render(photo, next()));
        expect(isLookDescriptor(look)).toBe(true);
        for (const [label, exposure, temperature] of [
          ["neutral", 0, 0],
          ["+1.5 EV", 1.5, 0],
          ["-1.5 EV", -1.5, 0],
          ["+30 temperature", 0, 30],
          ["-30 temperature", 0, -30],
        ] as const) {
          const target = render(
            photo,
            developSettingsSchema.parse({ ...defaultDevelopSettings(), exposure, temperature }),
          );
          load(target);
          const started = performance.now();
          const match = engine.matchLook([look], defaultDevelopSettings(), LOOK_SOURCE_EDGE);
          times.push(performance.now() - started);
          expect(match.applicable).toBe(true);
          const a = accuracy(describeFrame(render(target, match.settings)), look);
          (exposure > 0 ? clipped : unclipped).push(a);
        }
      }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const unclippedWorst = worst(unclipped),
      clippedWorst = worst(clipped);
    console.log(
      "look match worst unclipped",
      fixed(unclippedWorst),
      "worst +1.5 EV",
      fixed(clippedWorst),
      `wasm ms median ${sorted[sorted.length >> 1]!.toFixed(0)} max ${sorted.at(-1)!.toFixed(0)}`,
    );
    // Measured worst over 24 matches (neutral, -1.5 EV, +-30 temperature):
    // zone dE00 mean .50 / max .83, L* quantile 1.54, band saturation and
    // lightness .012. Bounds sit ~1.5-2x above for engine differences across
    // hosts; a mean zone error under .8 is below CIEDE2000's just-noticeable
    // difference.
    expect(unclippedWorst.zoneMean).toBeLessThan(0.8);
    expect(unclippedWorst.zoneMax).toBeLessThan(1.2);
    expect(unclippedWorst.quantileMax).toBeLessThan(2.5);
    expect(unclippedWorst.bandSaturation).toBeLessThan(0.025);
    expect(unclippedWorst.bandLightness).toBeLessThan(0.02);
    // +1.5 EV blows the bright volleyball sky and jerseys to white: the look's
    // highlight detail no longer exists in that copy (measured 2.25 / 3.03 /
    // 7.3 L* / .034 / .054).
    expect(clippedWorst.zoneMean).toBeLessThan(3.5);
    expect(clippedWorst.zoneMax).toBeLessThan(4.5);
    expect(clippedWorst.quantileMax).toBeLessThan(12);
    expect(clippedWorst.bandSaturation).toBeLessThan(0.06);
    expect(clippedWorst.bandLightness).toBeLessThan(0.1);
  }, 180_000);

  test("an inspiration from one photo moves a different photo most of the way to its look", () => {
    const next = looks(7);
    for (let i = 0; i < FIXTURES.length; i++) {
      const source = frames.get(FIXTURES[i]!)!;
      const target = frames.get(FIXTURES[(i + 1) % FIXTURES.length]!)!;
      const look = describeFrame(render(source, next()));
      const before = accuracy(describeFrame(target), look);
      load(target);
      const match = engine.matchLook([look], defaultDevelopSettings(), LOOK_SOURCE_EDGE);
      const after = accuracy(describeFrame(render(target, match.settings)), look);
      console.log(`look from ${FIXTURES[i]} on ${FIXTURES[(i + 1) % 3]}`, fixed(after));
      // Different content cannot become the same pixels. Measured: zone
      // error falls 73-86%, the worst L* quantile 56-79%.
      expect(after.zoneMean).toBeLessThan(before.zoneMean * 0.4);
      expect(after.quantileMax).toBeLessThan(before.quantileMax * 0.5);
    }
  }, 60_000);

  test("several inspirations combine into one look", () => {
    const next = looks(99);
    const photo = frames.get(FIXTURES[1])!;
    const recipe = next();
    const same = [0, 2].map((i) => describeFrame(render(frames.get(FIXTURES[i])!, recipe)));
    load(photo);
    const combined = engine.matchLook(same, defaultDevelopSettings(), LOOK_SOURCE_EDGE);
    expect(combined.applicable).toBe(true);
    expect(combined.distance).toBeGreaterThan(0);
    expect(() => engine.matchLook([], defaultDevelopSettings(), 1024)).toThrow();
    const stale = new Float64Array(same[0]!);
    stale[0] = 2;
    expect(() => engine.matchLook([stale], defaultDevelopSettings(), 1024)).toThrow();
  });
});

describe("Look match recipe contract", () => {
  function result(overrides: Record<number, number> = {}) {
    const values = new Float64Array(LOOK_RESULT_SIZE);
    values[0] = 1;
    const set = (at: number, ...numbers: number[]) =>
      numbers.forEach((n, i) => (values[at + i] = n));
    set(4, 0.35, 12, -20, 18, 5, -7, 9, -3, -10, 0, 6, 0);
    set(16, 3, 0, 0.04, 0.5, 0.55, 1, 0.97);
    for (let i = 0; i < 8; i++) set(49 + i * 3, i, -i, i * 2);
    set(73, 200, 18, 0, 0, 0, 0, 40, 12, 0, 0, 0, 0);
    set(85, 0, 50, 1, 14, 1, 0, 9, -22, 0, 0, 0, 1);
    for (const [at, value] of Object.entries(overrides)) values[Number(at)] = value;
    return values;
  }

  test("replaces the global look and keeps crop, masks, lens and detail work exactly", () => {
    const current = defaultDevelopSettings();
    current.crop = {
      x: 0.1,
      y: 0.05,
      width: 0.8,
      height: 0.9,
      angle: 2,
      rotate: 90,
      flipX: true,
      flipY: false,
    };
    current.masks = [
      {
        id: "m1",
        name: "Subject",
        enabled: true,
        type: "radial",
        x: 0.5,
        y: 0.4,
        radius: 0.3,
        aspect: 1,
        angle: 0,
        feather: 0.6,
        invert: false,
        exposure: 0.4,
        temperature: 0,
        saturation: 0,
      },
    ];
    Object.assign(current, {
      texture: 14,
      sharpening: 45,
      noiseReduction: 20,
      colorNoiseReduction: 10,
    });
    current.lensCorrection = {
      ...current.lensCorrection,
      enabled: true,
      vignetteCorrection: { enabled: true, amount: 10 },
    };
    current.parametricCurve = { ...current.parametricCurve, lights: 30 };
    current.channelCurves.red = [
      { x: 0, y: 0.1 },
      { x: 1, y: 1 },
    ];
    const match = lookMatchResult(current, result());
    const s = match.settings;
    expect(developSettingsSchema.parse(s)).toEqual(s);
    expect(s.crop).toEqual(current.crop);
    expect(s.masks).toEqual(current.masks);
    expect([s.texture, s.sharpening, s.noiseReduction, s.colorNoiseReduction]).toEqual([
      14, 45, 20, 10,
    ]);
    expect(s.lensCorrection).toEqual(current.lensCorrection);
    // The engine solved against Vignette with the lens correction folded in.
    expect(s.vignette).toBe(-32);
    expect([s.exposure, s.contrast, s.temperature, s.clarity]).toEqual([0.35, 12, 9, 6]);
    expect(s.curve).toEqual([
      { x: 0, y: 0.04 },
      { x: 0.5, y: 0.55 },
      { x: 1, y: 0.97 },
    ]);
    expect(s.curveInterpolation).toBe("smooth");
    expect(s.parametricCurve.lights).toBe(0);
    expect(s.channelCurves.red).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(s.grading.model).toBe("tonal");
    expect(s.grading.shadows).toEqual({ hue: 200, saturation: 18, luminance: 0 });
    expect([s.grain, s.fade]).toEqual([14, 9]);
  });

  test("keeps the photo untouched when the engine found nothing to match", () => {
    const current = defaultDevelopSettings();
    current.contrast = 33;
    const match = lookMatchResult(current, result({ 0: 0 }));
    expect(match.applicable).toBe(false);
    expect(match.settings).toEqual(current);
  });

  test("refuses a malformed engine result instead of writing it into a recipe", () => {
    expect(() => lookMatchResult(defaultDevelopSettings(), new Float64Array(12))).toThrow();
    expect(() => lookMatchResult(defaultDevelopSettings(), result({ 5: Number.NaN }))).toThrow();
    // A curve that does not start at x = 0 fails the recipe contract.
    expect(() => lookMatchResult(defaultDevelopSettings(), result({ 17: 0.2 }))).toThrow();
  });

  test("names every control the look changed, in panel order", () => {
    const before = defaultDevelopSettings();
    const after = lookMatchResult(before, result()).settings;
    const paths = lookChangedControls(before, after);
    expect(paths.slice(0, 3)).toEqual(["temp", "tint", "exposure"]);
    expect(paths).toContain("curve.mid");
    expect(paths).toContain("hsl.orange.sat");
    expect(paths).toContain("wheel.shadows.sat");
    expect(paths.at(-1)).toBe("vignette");
    expect(lookChangedControls(before, before)).toEqual([]);
  });

  test("descriptor guard accepts only this engine's format", () => {
    const good = new Float64Array(LOOK_DESCRIPTOR_SIZE);
    good[0] = 1;
    good[1] = LOOK_DESCRIPTOR_SIZE;
    expect(isLookDescriptor(good)).toBe(true);
    expect(isLookDescriptor(new Float64Array(LOOK_DESCRIPTOR_SIZE))).toBe(false);
    expect(isLookDescriptor([...good])).toBe(false);
    const nan = new Float64Array(good);
    nan[40] = Number.NaN;
    expect(isLookDescriptor(nan)).toBe(false);
  });
});
