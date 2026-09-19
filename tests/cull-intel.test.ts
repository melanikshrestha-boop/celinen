import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CULL_MEMBERSHIP_EVIDENCE,
  CULL_SIGNATURE_SIZE,
  instantiateCullIntelWasm,
  type CullIntelEngine,
  type CullMembershipInput,
  type CullSequenceInput,
} from "../src/lib/studio/cull/intel";
import { instantiateIngestWasm, type IngestEngine } from "../src/lib/studio/cull/ingest-engine";

// Runs the committed binaries: the exact bytes lenslab.dev serves.
const intelBinary = readFileSync(
  new URL("../src/lib/studio/cull/celinen-cull-intel.wasm", import.meta.url),
);
const ingestBinary = readFileSync(
  new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url),
);
const photo = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));

/** Photo-like detail: smooth value noise at three octaves, plus sensor grain. */
function detailed(width: number, height: number, seed = 12345, grain = 1.4) {
  const corner = (x: number, y: number, salt: number) => {
    let v = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed + salt) >>> 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
    return ((v ^ (v >>> 16)) & 0xffff) / 65535 - 0.5;
  };
  const octave = (x: number, y: number, cell: number, salt: number) => {
    const fx = x / cell,
      fy = y / cell;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty);
    const top = corner(x0, y0, salt) * (1 - sx) + corner(x0 + 1, y0, salt) * sx;
    const bottom = corner(x0, y0 + 1, salt) * (1 - sx) + corner(x0 + 1, y0 + 1, salt) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  let state = seed >>> 0;
  const noise = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff - 0.5) * grain * 3.4;
  };
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value =
        126 +
        60 * (octave(x, y, 3, 0) * 0.5 + octave(x, y, 9, 1) * 0.3 + octave(x, y, 27, 2) * 0.2);
      const i = (y * width + x) * 4;
      rgba[i] = value + noise();
      rgba[i + 1] = value + noise();
      rgba[i + 2] = value * 0.92 + noise();
      rgba[i + 3] = 255;
    }
  return rgba;
}

/** A bright textured blob on a dim, soft background: a subject. */
function withSubject(
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  soft: number,
) {
  const rgba = detailed(width, height, 5, 1.2);
  const subject = detailed(width, height, 99, 1.2);
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Background: blurred by averaging a wide neighbourhood.
      let sum = 0;
      let count = 0;
      for (let dy = -3; dy <= 3; dy += 3)
        for (let dx = -3; dx <= 3; dx += 3) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          sum += rgba[(sy * width + sx) * 4]!;
          count++;
        }
      const background = sum / count;
      const alpha = Math.max(0, Math.min(1, radius - Math.hypot(x - cx, y - cy) + 0.5));
      let value = background * 0.55;
      if (alpha > 0) {
        // The subject, softened by `soft` pixels of blur.
        let inner = 0;
        let innerCount = 0;
        for (let dy = -soft; dy <= soft; dy++)
          for (let dx = -soft; dx <= soft; dx++) {
            const sx = Math.min(width - 1, Math.max(0, x + dx));
            const sy = Math.min(height - 1, Math.max(0, y + dy));
            inner += subject[(sy * width + sx) * 4]!;
            innerCount++;
          }
        value = value * (1 - alpha) + (30 + (inner / innerCount) * 0.95) * alpha;
      }
      out[i] = value * 1.05;
      out[i + 1] = value;
      out[i + 2] = value * 0.85;
      out[i + 3] = 255;
    }
  return out;
}

function flat(width: number, height: number, level: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = level;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function staticNoise(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let state = 7;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) & 0xff;
  };
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = next();
    rgba[i * 4 + 1] = next();
    rgba[i * 4 + 2] = next();
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** A flat-filled drawing: exact colour regions with hard outlines. */
function illustration(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const palette = [
    [235, 240, 250],
    [250, 220, 200],
    [60, 90, 170],
    [90, 150, 80],
    [30, 30, 35],
  ];
  const set = (i: number, c: number[]) => {
    rgba[i] = c[0]!;
    rgba[i + 1] = c[1]!;
    rgba[i + 2] = c[2]!;
    rgba[i + 3] = 255;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cx = width * 0.5,
        cy = height * 0.45,
        r = Math.hypot(x - cx, y - cy);
      if (r < 70) set(i, r > 66 ? palette[4]! : palette[1]!);
      else if (y > height * 0.72) set(i, palette[3]!);
      else if (Math.abs(x - width * 0.2) < 40 && y > height * 0.3) set(i, palette[2]!);
      else set(i, palette[0]!);
    }
  return rgba;
}

let intel: CullIntelEngine;
let ingest: IngestEngine;
beforeAll(async () => {
  intel = await instantiateCullIntelWasm(intelBinary);
  ingest = await instantiateIngestWasm(ingestBinary);
});

describe("the validity gate, through wasm", () => {
  test("a photograph passes and says nothing", () => {
    const { validity, subject, signature } = intel.frame(detailed(480, 320), 480, 320);
    expect(validity.state).toBe("valid");
    expect(validity.kind).toBe("photo");
    expect(validity.reason).toBe("");
    expect(validity.evidence.spectralSlope).toBeGreaterThan(0.8);
    expect(signature.length).toBe(CULL_SIGNATURE_SIZE);
    expect(subject.evidence.length).toBeGreaterThan(0);
  });

  test("static, a blank frame and a drawing are caught, each with its own words", () => {
    const noise = intel.frame(staticNoise(480, 320), 480, 320).validity;
    expect(noise.state).toBe("invalid");
    expect(noise.kind).toBe("noise");
    expect(noise.reason).toBe("No photographic structure");

    const blank = intel.frame(flat(480, 320, 128), 480, 320).validity;
    expect(blank.kind).toBe("flat");
    expect(blank.reason).toBe("Blank frame");

    const drawn = intel.frame(illustration(480, 320), 480, 320).validity;
    expect(drawn.state).toBe("invalid");
    expect(["illustration", "screenshot", "test-pattern"]).toContain(drawn.kind);
    expect(drawn.confidence).toBeGreaterThan(0.85);
  });

  test("the decoder's own view of the file counts: a premature end is corruption", () => {
    const rgba = detailed(480, 320);
    for (let y = 180; y < 320; y++)
      for (let x = 0; x < 480; x++) {
        const i = (y * 480 + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 128;
      }
    const cut = intel.frame(rgba, 480, 320, { warnings: 1, truncated: true }).validity;
    expect(cut.kind).toBe("corrupted");
    expect(cut.reason).toBe("Corrupted file");
    expect(cut.evidence.frozenRows).toBeGreaterThan(0.3);
  });

  test("the subject hierarchy reports which evidence it used, never 'no face'", () => {
    const { subject } = intel.frame(withSubject(480, 320, 320, 140, 55, 1), 480, 320);
    expect(["salient", "frame"]).toContain(subject.level);
    expect(subject.evidence).toContain("Focus judged on");
    expect(subject.focus).toBeGreaterThan(0);
    const soft = intel.frame(withSubject(480, 320, 320, 140, 55, 4), 480, 320).subject;
    expect(subject.focus).toBeGreaterThan(soft.focus);
  });

  test("a frame that fails the gate is never scored", () => {
    const rgba = illustration(480, 320);
    const { validity } = intel.frame(rgba, 480, 320);
    expect(validity.state).toBe("invalid");
    // The ingest module runs the same gate over a decoded file; see below.
    expect(() => intel.frame(new Uint8ClampedArray(4), 480, 320)).toThrow();
  });
});

describe("the real photographs in tests/fixtures", () => {
  test("every fixture photograph passes the gate, keeps its score, and carries its facts", () => {
    for (const name of [
      "basketball-hangar-usnavy-pd.jpg",
      "basketball-action-usaf-pd.jpg",
      "volleyball-portrait-cc0.jpg",
    ]) {
      const result = ingest.read(photo(name));
      expect(result.validity!.state).toBe("valid");
      expect(result.validity!.reason).toBe("");
      expect(result.measured).toBe(true);
      expect(result.reading.quality).toBeGreaterThan(0);
      expect(result.signature!.length).toBe(CULL_SIGNATURE_SIZE);
      expect(result.subject!.level).not.toBe("none");
      // Facts are absent, not blank, when a file carries no EXIF; every one
      // of these carries it.
      expect(result.facts?.make.length).toBeGreaterThan(0);
      expect(result.validity!.evidence.decoderWarnings).toBe(0);
    }
    const navy = ingest.read(photo("basketball-hangar-usnavy-pd.jpg"));
    expect(navy.facts?.model).toBe("nikon d700");
    expect(navy.facts?.serial).toBe("2311811");
  });

  test("a truncated photograph is named as damaged, and still measured", () => {
    const bytes = photo("basketball-hangar-usnavy-pd.jpg");
    const cut = bytes.subarray(0, Math.floor(bytes.length * 0.45));
    const result = ingest.read(cut);
    expect(result.validity!.evidence.decoderWarnings).toBeGreaterThan(0);
    expect(result.validity!.kind).toBe("corrupted");
    expect(result.damaged).toMatch(/cut short/i);
    // A file that stopped mid-decode is still a photograph of the game. The
    // gate names it and `damaged` says the readings are taken over partly
    // gray pixels, but the photographer still gets the frame's numbers —
    // unlike a drawing, where there is no photograph for a number to be about.
    expect(result.measured).toBe(true);
    expect(result.reading.quality).toBeGreaterThan(0);
  });

  test("a drawing dropped into a shoot is never called a photograph", () => {
    // The founder's own case: a manga page and an anime still read 98 and 80
    // with "Sharp and well exposed" before this gate ran.
    const drawn = intel.frame(illustration(480, 320), 480, 320).validity;
    expect(drawn.state).toBe("invalid");
    expect(drawn.reason.length).toBeGreaterThan(0);
    expect(drawn.kind).not.toBe("photo");
  });
});

describe("shoot membership, through wasm", () => {
  const shoot = (): CullMembershipInput[] => {
    const frames: CullMembershipInput[] = [];
    for (let i = 0; i < 60; i++)
      frames.push({
        hasExif: true,
        make: "sony",
        model: "ilce-7m4",
        serial: "3901",
        lens: "fe 85mm f1.4 gm",
        fileName: `_DSC${(4000 + i).toString().padStart(4, "0")}.JPG`,
        captureTimeMs: 1.78e12 + i * 12_000,
        width: 7008,
        height: 4672,
        hash: "0f0f0f0f0f0f0f0f",
        color: Uint8Array.from({ length: 48 }, (_, k) => 120 + (k % 7)),
      });
    return frames;
  };

  test("one camera, one afternoon: nobody is flagged", () => {
    for (const row of intel.membership(shoot())) {
      expect(row.state).toBe("member");
      expect(row.reason).toBe("");
    }
  });

  test("downloads dropped into the shoot are outsiders, with reasons", () => {
    const frames = shoot();
    frames.push({
      fileName: "images (3).jpeg",
      width: 736,
      height: 1104,
      hash: "ffffffffffffffff",
      color: Uint8Array.from({ length: 48 }, () => 240),
    });
    frames.push({
      fileName: "manga_chapter_12.jpg",
      width: 1170,
      height: 2532,
      hash: "123456789abcdef0",
      color: Uint8Array.from({ length: 48 }, () => 250),
    });
    const rows = intel.membership(frames);
    for (const row of rows.slice(0, 60)) expect(row.state).toBe("member");
    for (const row of rows.slice(60)) {
      expect(row.state).toBe("outsider");
      expect(row.reason).toContain("No camera data");
      expect(row.evidence & CULL_MEMBERSHIP_EVIDENCE.noCameraData).toBeTruthy();
      expect(row.confidence).toBeGreaterThan(0.85);
    }
  });

  test("a frame from the same camera three years earlier is a maybe, not a verdict", () => {
    const frames = shoot();
    frames.push({
      ...frames[0]!,
      fileName: "_DSC9001.JPG",
      captureTimeMs: 1.78e12 - 3 * 365.25 * 24 * 3600 * 1000,
    });
    const row = intel.membership(frames).at(-1)!;
    expect(row.state).toBe("suspect");
    expect(row.reason).toBe("Taken 3 years before this shoot");
    expect(row.timeOffsetMs).toBeLessThan(0);
  });

  test("invalid frames never define the shoot", () => {
    const frames = shoot();
    frames.push({ fileName: "noise.jpg", width: 640, height: 480, invalid: true });
    const row = intel.membership(frames).at(-1)!;
    expect(row.state).toBe("member");
    expect(row.reason).toBe("");
  });
});

describe("burst roles, through wasm", () => {
  function burstFrame(index: number, focus: number, group = 4): CullSequenceInput {
    // A subject that rises and falls: the apex is frame 4.
    const t = index - 4;
    const y = 0.25 + 0.03 * t * t;
    const signature = new Uint8Array(CULL_SIGNATURE_SIZE);
    for (let row = 0; row < 24; row++)
      for (let column = 0; column < 32; column++) {
        const dx = column - (6 + index * 2.2),
          dy = row - y * 24 - 4;
        signature[row * 32 + column] =
          Math.hypot(dx, dy) < 4 ? 230 : 60 + ((row * 7 + column * 3) % 20);
      }
    return {
      group,
      captureTimeMs: 1.78e12 + index * 60,
      signature,
      subject: {
        level: "salient",
        region: { x: 0.2 + index * 0.06, y, width: 0.2, height: 0.2, confidence: 0.6 },
        focus,
        focusConfidence: 0.7,
        eyeFocus: -1,
        eyesOpen: -1,
        subjectSize: 0.04,
        saliency: 0.5,
        evidence: "Focus judged on the most distinct region",
      },
      heads: { exposure: { value: 0.9, confidence: 0.7 } },
      validity: "valid",
    };
  }

  test("the sharp apex is the pick; the others are build-up and follow-through", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
      burstFrame(index, index === 4 ? 0.8 : 0.45),
    );
    const rows = intel.sequence(frames);
    const pick = rows.findIndex((row) => row.role === "pick");
    expect(pick).toBe(4);
    expect(rows[4]!.atPeak).toBe(true);
    expect(rows[4]!.reason).toContain("Sharpest subject");
    expect(rows[4]!.heads.peakAction?.value).toBe(1);
    expect(rows[0]!.role).toBe("build-up");
    expect(rows[0]!.reason.startsWith("Before the peak")).toBe(true);
    expect(rows[8]!.role).toBe("follow-through");
    expect(rows[8]!.reason.startsWith("After the peak")).toBe(true);
    for (const row of rows) {
      expect(row.burstSize).toBe(9);
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  test("a frame the photographer kept is the pick, in their words", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
      burstFrame(index, index === 4 ? 0.8 : 0.45),
    );
    frames[7]!.verdict = 1;
    const rows = intel.sequence(frames);
    expect(rows[7]!.role).toBe("pick");
    expect(rows[7]!.reason).toBe("Your pick");
    expect(rows[4]!.role).not.toBe("pick");
  });

  test("frames outside a burst get no role, and a suspect frame goes to review", () => {
    const frames = [
      burstFrame(0, 0.6, -1),
      burstFrame(1, 0.6),
      burstFrame(2, 0.6),
      burstFrame(3, 0.6),
    ];
    frames[3]!.validity = "suspect";
    const rows = intel.sequence(frames);
    expect(rows[0]!.role).toBe("none");
    expect(rows[0]!.reason).toBe("");
    expect(rows[3]!.role).toBe("review");
    expect(rows[3]!.reason).toBe("May not be a photograph");
  });

  test("the genre changes the ranking", () => {
    const frames = [burstFrame(3, 0.8), burstFrame(4, 0.6)];
    frames[0]!.heads = { eyesOpen: { value: 0, confidence: 0.9 } };
    frames[1]!.heads = {
      eyesOpen: { value: 1, confidence: 0.9 },
      expression: { value: 0.7, confidence: 0.6 },
    };
    expect(intel.sequence(frames, { genre: "sports" })[0]!.role).toBe("pick");
    expect(intel.sequence(frames, { genre: "portrait" })[1]!.role).toBe("pick");
  });

  test("an unknown genre is refused rather than guessed", () => {
    expect(() => intel.sequence([burstFrame(0, 0.5)], { genre: "night" as never })).toThrow();
  });
});
