import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const compiler = Bun.which("clang++");
const libraw = resolve("native/build/deps/libraw-0.22.2");
const library = join(libraw, "lib/libraw_r.a");
// The committed decoder has one wrapper; newer local high-resolution work has
// two. Detect the actual implementation, never assume local-only APIs exist in
// a clean checkout, and assert which wrappers really execute below.
const hasHighResolution = /^std::vector<std::uint8_t>\s+encode_develop_jpeg\s*\(/m.test(
  readFileSync(resolve("native/src/decode_mac.cpp"), "utf8"),
);
const supported =
  process.platform === "darwin" &&
  compiler !== null &&
  existsSync(library) &&
  existsSync(join(libraw, "include/libraw/libraw.h"));

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 25_000);
  try {
    const [output, error, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output, error, status };
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!supported)("opaque native JPEG fast path", () => {
  let directory = "";
  let optimized = "";
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "foto-jpeg-opaque-test-"));
  });
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function compile(sanitized: boolean) {
    const binary = join(directory, sanitized ? "probe-sanitized" : "probe");
    const result = await run([
      compiler!,
      "-std=c++20",
      "-pthread",
      ...(hasHighResolution ? ["-DFOTO_JPEG_HAS_HIGH_RESOLUTION=1"] : []),
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
      resolve("tests/fixtures/develop-jpeg-opaque-probe.cpp"),
      library,
      "-framework",
      "ImageIO",
      "-framework",
      "CoreGraphics",
      "-framework",
      "CoreFoundation",
      "-o",
      binary,
    ]);
    if (result.status !== 0) throw new Error(`JPEG probe compile failed: ${result.error}`);
    return binary;
  }

  for (const sanitized of [false, true]) {
    test(`${sanitized ? "ASan/UBSan" : "optimized"}: exact old JPEGs, alias/copy contract, transparency, admission and concurrency`, async () => {
      const binary = await compile(sanitized);
      if (!sanitized) optimized = binary;
      const result = await run([binary]);
      if (result.status !== 0) throw new Error(`JPEG probe failed: ${result.error}`);
      expect(JSON.parse(result.output)).toEqual({
        cases: 1040,
        opaqueCases: 76,
        compositedCases: 964,
        invalidCases: 28,
        concurrentCases: 24,
        wrapperCoverage: hasHighResolution
          ? { encode_jpeg: 524, encode_develop_jpeg: 516 }
          : { encode_jpeg: 1040 },
        exact: true,
        sourcePreserved: true,
        borrowedOpaqueInput: true,
      });
    }, 40_000);
  }

  test("structural ownership regression rejects the literal old encoder, despite identical JPEG pixels", async () => {
    if (!optimized) optimized = await compile(false);
    const result = await run([optimized, "--legacy-control"]);
    expect(result.status).toBe(1);
    expect(result.error).toContain("OPAQUE_INPUT_WAS_COPIED");
    expect(result.error).not.toContain("JPEG_BYTES_CHANGED");
  }, 30_000);
});
