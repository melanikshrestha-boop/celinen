import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generatedBayerDng } from "./fixtures/generated-bayer";

const kinds = ["camera", "missing", "red-zero", "green-zero", "blue-zero", "all-zero"] as const;
type Kind = (typeof kinds)[number];
function source(kind: Kind, orientation: number) {
  const bytes = generatedBayerDng({ orientation });
  const ifd = bytes.readUInt32LE(4);
  for (let index = 0; index < bytes.readUInt16LE(ifd); index++) {
    const offset = ifd + 2 + index * 12;
    if (bytes.readUInt16LE(offset) !== 50728) continue;
    if (kind === "missing") bytes.writeUInt16LE(65000, offset);
    else if (kind !== "camera") {
      const payload = bytes.readUInt32LE(offset + 8);
      for (let channel = 0; channel < 3; channel++)
        if (
          kind === "all-zero" ||
          channel === ["red-zero", "green-zero", "blue-zero"].indexOf(kind)
        )
          bytes.writeUInt32LE(0, payload + channel * 8);
    }
    return bytes;
  }
  throw new Error("Generated DNG lacks AsShotNeutral.");
}
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function safetySource(kind: "unnormalized" | "unsafe-scale" | "unsupported-colors") {
  const bytes = source("missing", 1);
  const ifd = bytes.readUInt32LE(4);
  const tag = (id: number) => {
    for (let index = 0; index < bytes.readUInt16LE(ifd); index++) {
      const offset = ifd + 2 + index * 12;
      if (bytes.readUInt16LE(offset) === id) return offset;
    }
    throw new Error(`Missing synthetic TIFF tag ${id}`);
  };
  if (kind === "unsupported-colors") {
    Buffer.from([1, 3, 4, 5]).copy(bytes, tag(33422) + 8);
    const plane = tag(50710);
    bytes.writeUInt32LE(4, plane + 4);
    Buffer.from([1, 3, 4, 5]).copy(bytes, plane + 8);
    bytes.writeUInt16LE(65001, tag(50721));
    return bytes;
  }
  if (kind === "unnormalized") {
    const matrix = bytes.readUInt32LE(tag(50721) + 8);
    for (const entry of [0, 4, 8]) bytes.writeInt32LE(1_000_000, matrix + entry * 8);
  }
  const sensor = bytes.readUInt32LE(tag(273) + 8);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++) {
      const value =
        kind === "unnormalized"
          ? 64
          : y % 2 === 0 && x % 2 === 0
            ? 2064
            : y % 2 === 1 && x % 2 === 1
              ? 64
              : 1064;
      bytes.writeUInt16LE(value, sensor + (y * 128 + x) * 2);
    }
  if (kind === "unsafe-scale") bytes.writeUInt16LE(65, sensor + (128 + 1) * 2);
  return bytes;
}
type Measurement = {
  exposure: number;
  temperature: number;
  tint: number;
  width: number;
  height: number;
  legacyHash: string;
  legacyExact: boolean;
  mae: number;
  maximum: number;
  alphaPreserved: boolean;
};
const compiler = Bun.which("clang++");
const dependency = resolve("native/build/deps/libraw-0.22.2");
const supported =
  process.platform === "darwin" &&
  compiler !== null &&
  existsSync(join(dependency, "lib/libraw_r.a"));

// Independent legacy goldens are filled from the previous implementation, not
// from the new five-argument wrapper. Pinned LibRaw 0.22.2, macOS arm64, -O2.
const legacyGoldens: Record<string, string> = {
  "camera-1": "56f60bcd80fb8d4203aea8222ad6640dfeedff68765ed5838e5c5b5c1d205cab",
  "missing-1": "ef79034215978eb941946d41d9b8b515674a912aa83998b7810e2c3ec529347d",
  "red-zero-1": "ef79034215978eb941946d41d9b8b515674a912aa83998b7810e2c3ec529347d",
  "green-zero-1": "56f60bcd80fb8d4203aea8222ad6640dfeedff68765ed5838e5c5b5c1d205cab",
  "blue-zero-1": "ef79034215978eb941946d41d9b8b515674a912aa83998b7810e2c3ec529347d",
  "all-zero-1": "ef79034215978eb941946d41d9b8b515674a912aa83998b7810e2c3ec529347d",
  "camera-6": "524d04622813d867313e0f39f8607e32c3fe43c73e869a019d0a4f1502f6c28c",
  "missing-6": "d72fbfaa0fb11b222a62f99ed6f457d0d8db43e97cbd7d9c4194a9124583caa5",
  "red-zero-6": "d72fbfaa0fb11b222a62f99ed6f457d0d8db43e97cbd7d9c4194a9124583caa5",
  "green-zero-6": "524d04622813d867313e0f39f8607e32c3fe43c73e869a019d0a4f1502f6c28c",
  "blue-zero-6": "d72fbfaa0fb11b222a62f99ed6f457d0d8db43e97cbd7d9c4194a9124583caa5",
  "all-zero-6": "d72fbfaa0fb11b222a62f99ed6f457d0d8db43e97cbd7d9c4194a9124583caa5",
};

describe.skipIf(!supported)(
  "native opt-in continuous RAW white balance (not editor integration)",
  () => {
    let directory = "";
    const files: string[] = [];
    const measurements = new Map<string, Measurement[]>();
    async function run(command: string[], timeout = 15_000) {
      const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill(), timeout);
      try {
        const [output, error, status] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (status !== 0) throw new Error(`Native WB regression failed (${status}): ${error}`);
        return output;
      } finally {
        clearTimeout(timer);
      }
    }
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "foto-wb-continuous-"));
      files.push("probe");
      // Build current source in isolation: never replace the app's native binary
      // or accidentally test a stale develop_raw.o from a previous build.
      await run(
        [
          compiler!,
          "-std=c++20",
          "-O2",
          "-Wall",
          "-Wextra",
          "-Wpedantic",
          "-I",
          resolve("native/include"),
          "-I",
          join(dependency, "include"),
          resolve("tests/fixtures/develop-raw-wb-continuous-probe.cpp"),
          resolve("native/src/develop_raw.cpp"),
          join(dependency, "lib/libraw_r.a"),
          "-o",
          join(directory, "probe"),
        ],
        30_000,
      );
      for (const orientation of [1, 6])
        for (const kind of kinds) {
          const name = `${kind}-${orientation}.dng`,
            bytes = source(kind, orientation);
          files.push(name);
          const path = join(directory, name);
          await writeFile(path, bytes);
          const output = await run([join(directory, "probe"), path]);
          expect(sha256(readFileSync(path))).toBe(sha256(bytes));
          measurements.set(
            `${kind}-${orientation}`,
            output
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line)),
          );
        }
    }, 90_000);
    afterAll(async () => {
      if (!directory) return;
      for (const name of files) await unlink(join(directory, name)).catch(() => {});
      await rmdir(directory);
    });

    test("old five-argument API equals explicit legacy with exact pixels and source hashes", () => {
      expect(measurements.size).toBe(12);
      for (const [key, rows] of measurements) {
        expect(rows).toHaveLength(48);
        expect(rows.every((row) => row.legacyExact)).toBe(true);
        if (process.arch === "arm64")
          expect(sha256(rows.map((row) => row.legacyHash).join("\n"))).toBe(legacyGoldens[key]);
      }
    });
    test("zero, signed zero and ±tiny Temp/Tint keep the neutral appearance for every WB variant", () => {
      for (const rows of measurements.values()) {
        const tiny = rows.filter(
          (row) => Math.max(Math.abs(row.temperature), Math.abs(row.tint)) <= 1e-6,
        );
        expect(tiny).toHaveLength(18);
        for (const row of tiny) {
          expect(row.maximum).toBe(0);
          expect(row.mae).toBe(0);
        }
      }
    });
    test("small adjustments avoid the missing-WB baseline jump, including clipping extremes", () => {
      for (const rows of measurements.values()) {
        const small = rows.filter(
          (row) => Math.max(Math.abs(row.temperature), Math.abs(row.tint)) === 0.1,
        );
        expect(small).toHaveLength(12);
        for (const row of small) {
          // A clipped/demosaiced boundary can move by several codes at +5 EV;
          // a universal max-one assertion would confuse local detail with a WB jump.
          expect(row.mae).toBeLessThan(0.15);
          if (row.exposure === 0) expect(row.maximum).toBeLessThanOrEqual(4);
        }
        expect(rows.some((row) => Math.abs(row.temperature) === 100 && row.mae > 1)).toBe(true);
        expect(rows.some((row) => Math.abs(row.tint) === 100 && row.mae > 1)).toBe(true);
      }
    });
    test("all controls retain finite output, dimensions, orientation and opaque alpha", () => {
      for (const [key, rows] of measurements)
        for (const row of rows) {
          expect([row.width, row.height]).toEqual(key.endsWith("-1") ? [128, 96] : [96, 128]);
          expect(row.alphaPreserved).toBe(true);
          expect(Number.isFinite(row.mae)).toBe(true);
          expect(row.maximum).toBeGreaterThanOrEqual(0);
          expect(row.maximum).toBeLessThanOrEqual(255);
        }
    });
    test("rejects invalid enum values, NaN, infinities and controls outside bounds before file access", async () => {
      expect(JSON.parse(await run([join(directory, "probe"), "--invalid"]))).toEqual({
        rejectedBeforeSourceAccess: 37,
      });
    });
    test("rejects unsupported colors, unnormalized fallback and finite scales unsafe for integer conversion", async () => {
      const cases = [
        [
          "unnormalized",
          "RAW white-balance baseline could not be normalized. No fallback adjustment was used.",
        ],
        ["unsafe-scale", "RAW white-balance scale exceeds the safe sensor arithmetic range."],
        [
          "unsupported-colors",
          "Resolved relative RAW white balance requires an RGB/RGBG sensor pipeline.",
        ],
      ] as const;
      for (const [kind, message] of cases) {
        const name = `${kind}.dng`,
          bytes = safetySource(kind),
          path = join(directory, name);
        files.push(name);
        await writeFile(path, bytes);
        expect(
          JSON.parse(await run([join(directory, "probe"), "--reject", path, message])),
        ).toEqual({ rejectedWithoutImage: 3 });
        // Do not send deliberately unsafe scales through the unmodified legacy
        // arithmetic merely to characterize its bug. Safe zero paths stay exact.
        if (kind !== "unsafe-scale")
          expect(JSON.parse(await run([join(directory, "probe"), "--neutral", path]))).toEqual({
            neutralExact: true,
          });
        expect(sha256(readFileSync(path))).toBe(sha256(bytes));
      }
    });
  },
);
