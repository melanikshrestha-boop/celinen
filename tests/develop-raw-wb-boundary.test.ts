import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generatedBayerDng } from "./fixtures/generated-bayer";

/** Original synthetic fixture; rename only the AsShotNeutral TIFF tag, keeping
 * its payload, all sensor samples and all other metadata byte-identical. */
function fixtures() {
  const camera = generatedBayerDng();
  const missing = Buffer.from(camera);
  const ifd = missing.readUInt32LE(4);
  const count = missing.readUInt16LE(ifd);
  let tagOffset = -1;
  for (let index = 0; index < count; index++) {
    const offset = ifd + 2 + index * 12;
    if (missing.readUInt16LE(offset) === 50728) {
      tagOffset = offset;
      missing.writeUInt16LE(65000, offset);
      break;
    }
  }
  if (tagOffset < 0) throw new Error("Generated fixture lacks AsShotNeutral.");
  return { camera, missing, tagOffset };
}

test("missing-WB fixture changes only the generated AsShotNeutral tag identifier", () => {
  const { camera, missing, tagOffset } = fixtures();
  expect(camera.length).toBe(missing.length);
  const restored = Buffer.from(missing);
  expect(restored.readUInt16LE(tagOffset)).toBe(65000);
  restored.writeUInt16LE(50728, tagOffset);
  expect(restored).toEqual(camera);
  expect(generatedBayerDng()).toEqual(camera);
});

type Measurement = {
  control: "temperature" | "tint";
  amount: number;
  width: number;
  height: number;
  mae: number;
  maximum: number;
  changedChannels: number;
  alphaPreserved: boolean;
};
const build = resolve("native/build");
const dependencies = [
  join(build, "develop_raw.o"),
  join(build, "decode_mac.o"),
  join(build, "deps/libraw-0.22.2/lib/libraw_r.a"),
];
const compiler = Bun.which("clang++");
const supported =
  process.platform === "darwin" && compiler !== null && dependencies.every(existsSync);

describe.skipIf(!supported)("current legacy RAW WB boundary — diagnostic, not fixed", () => {
  let directory = "";
  let camera: Measurement[] = [];
  let missing: Measurement[] = [];
  async function run(command: string[]) {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const [output, error, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (status !== 0) throw new Error(`WB diagnostic failed (${status}): ${error}`);
      return output;
    } finally {
      clearTimeout(timer);
    }
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "foto-wb-boundary-"));
    const binary = join(directory, "probe");
    await run([
      compiler!,
      "-std=c++20",
      "-O2",
      "-I",
      resolve("native/include"),
      resolve("tests/fixtures/develop-raw-wb-probe.cpp"),
      ...dependencies,
      "-framework",
      "ImageIO",
      "-framework",
      "CoreGraphics",
      "-framework",
      "CoreFoundation",
      "-o",
      binary,
    ]);
    const sources = fixtures();
    for (const kind of ["camera", "missing"] as const) {
      const path = join(directory, `${kind}.dng`);
      await writeFile(path, sources[kind]);
      const output = await run([binary, path]);
      const measurements = output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Measurement);
      expect(readFileSync(path)).toEqual(sources[kind]);
      if (kind === "camera") camera = measurements;
      else missing = measurements;
    }
  }, 30_000);
  afterAll(async () => {
    if (!directory) return;
    for (const name of ["probe", "camera.dng", "missing.dng"])
      await unlink(join(directory, name)).catch(() => {});
    await rmdir(directory);
  });

  test("both generated sources decode; relative WB preserves dimensions, alpha and originals", () => {
    expect(camera).toHaveLength(8);
    expect(missing).toHaveLength(8);
    for (const result of [...camera, ...missing]) {
      expect(result.width).toBe(128);
      expect(result.height).toBe(96);
      expect(result.alphaPreserved).toBe(true);
      expect(Number.isFinite(result.mae)).toBe(true);
      expect(result.maximum).toBeGreaterThanOrEqual(0);
      expect(result.maximum).toBeLessThanOrEqual(255);
    }
  });
  test("valid camera WB has no tiny-perturbation jump and at most one RGB code change at ±0.1", () => {
    for (const result of camera) {
      expect(result.maximum).toBeLessThanOrEqual(1);
      if (Math.abs(result.amount) < 0.1) {
        expect(result.maximum).toBe(0);
        expect(result.changedChannels).toBe(0);
      }
    }
  });
  test("characterizes the CURRENT legacy missing-WB discontinuity, not a future output requirement", () => {
    // Exact zero uses LibRaw camera/automatic WB. Nonzero uses daylight pre_mul.
    // Replace this diagnostic when an explicit versioned model fixes the branch;
    // do not preserve the defect or silently change existing recipe semantics.
    for (const result of missing) {
      expect(result.mae).toBeGreaterThan(1);
      expect(result.maximum).toBeGreaterThan(10);
    }
    const tiny = missing.filter((result) => Math.abs(result.amount) < 0.1);
    expect(tiny).toHaveLength(4);
    expect(new Set(tiny.map((result) => result.mae)).size).toBe(1);
  });
});

test.todo(
  "new opt-in RAW WB model uses one baseline at zero and ±tiny Temp/Tint, including missing/partial camera WB; legacy saved recipes remain unchanged",
);
