import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const compiler = Bun.which("clang++");
const libraw = resolve("native/build/deps/libraw-0.22.2");
const dependencies = [resolve("native/build/decode_mac.o"), join(libraw, "lib/libraw_r.a")];
const supported =
  process.platform === "darwin" &&
  compiler !== null &&
  dependencies.every(existsSync) &&
  existsSync(join(libraw, "include/libraw/libraw.h"));

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [output, error, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (status !== 0) throw new Error(`RAW resampler check failed (${status}): ${error}`);
    return output;
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!supported)("private native RAW box resampler", () => {
  let directory = "";
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "foto-raw-resampler-"));
  });
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  for (const sanitized of [false, true]) {
    test(`${sanitized ? "ASan/UBSan" : "optimized"}: exact legacy pixels, bounds, alpha and immutable source`, async () => {
      const binary = join(directory, sanitized ? "probe-sanitized" : "probe");
      await run([
        compiler!,
        "-std=c++20",
        ...(sanitized
          ? [
              "-O1",
              "-g",
              "-fsanitize=address,undefined",
              "-fno-sanitize-recover=all",
              "-fno-omit-frame-pointer",
            ]
          : ["-O3", "-DNDEBUG"]),
        "-I",
        resolve("native/include"),
        "-I",
        join(libraw, "include"),
        resolve("tests/fixtures/develop-raw-resample-probe.cpp"),
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
      const result = JSON.parse(await run([binary])) as {
        cases: number;
        comparedBytes: number;
        exact: boolean;
        sourcePreserved: boolean;
        alphaOpaque: boolean;
      };
      // Native assertions compare every byte, including rounding-sensitive
      // samples, and fail on the first mismatch; these counts prevent a
      // truncated fixture or early success from silently passing this suite.
      expect(result).toEqual({
        cases: 25_733,
        comparedBytes: 52_415_596,
        exact: true,
        sourcePreserved: true,
        alphaOpaque: true,
      });
    }, 30_000);
  }
});
