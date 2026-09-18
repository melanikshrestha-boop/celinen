import { describe, expect, test } from "bun:test";
import {
  cameraParts,
  parseTemplate,
  renderTemplate,
  sanitizeSegment,
  TemplateError,
  validateTemplate,
} from "../src/lib/studio/cull/handoff/template";

// 2026-09-17 18:04:05 as camera-clock fields (stored as if UTC).
const CAMERA_CLOCK = Date.UTC(2026, 8, 17, 18, 4, 5);

const ctx = {
  fileName: "_DSC5098.ARW",
  relativePath: "DCIM/100MSDCF/_DSC5098.ARW",
  captureTimeMs: CAMERA_CLOCK,
  captureTimeBasis: "camera_clock" as const,
  fallbackTimeMs: 0,
  seq: 42,
  cameraKey: "SONY|ILCE-1|4012345",
  shootName: "State Finals",
};

describe("rename templates", () => {
  test("renders every token", () => {
    expect(renderTemplate("{date}_{time}_{seq:4}", ctx)).toEqual(["2026-09-17_180405_0042"]);
    expect(renderTemplate("{yyyy}.{yy}.{mm}.{dd}-{hh}{min}{ss}", ctx)).toEqual([
      "2026.26.09.17-180405",
    ]);
    expect(renderTemplate("{camera} {make} {serial}", ctx)).toEqual(["ILCE-1 SONY 4012345"]);
    expect(renderTemplate("{folder}-{filename}", ctx)).toEqual(["100MSDCF-_DSC5098"]);
    expect(renderTemplate("{shootName} {seq}", ctx)).toEqual(["State Finals 42"]);
  });

  test("a camera clock is read as the camera showed it, whatever the page's zone", () => {
    const original = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    try {
      expect(renderTemplate("{date} {hh}", ctx)).toEqual(["2026-09-17 18"]);
    } finally {
      process.env.TZ = original;
    }
  });

  test("falls back to the file time when there is no capture time", () => {
    const local = new Date(2025, 0, 2, 3, 4, 5).getTime();
    expect(
      renderTemplate("{date}_{time}", { ...ctx, captureTimeMs: null, fallbackTimeMs: local }),
    ).toEqual(["2025-01-02_030405"]);
  });

  test("literal slashes make folders, token values never do", () => {
    expect(renderTemplate("{yyyy}/{date} {shootName}/{filename}", ctx)).toEqual([
      "2026",
      "2026-09-17 State Finals",
      "_DSC5098",
    ]);
    expect(
      renderTemplate("{shootName}/{filename}", { ...ctx, shootName: "../../etc/passwd" }),
    ).toEqual([".._.._etc_passwd", "_DSC5098"]);
  });

  test("empty segments are dropped and an empty name is an error", () => {
    expect(renderTemplate("{folder}/{filename}", { ...ctx, relativePath: undefined })).toEqual([
      "_DSC5098",
    ]);
    expect(() => renderTemplate("{shootName}", { ...ctx, shootName: "" })).toThrow(TemplateError);
    expect(() => renderTemplate("{shootName}", { ...ctx, shootName: ".." })).toThrow(TemplateError);
  });

  test("rejects unknown tokens and bad braces up front", () => {
    expect(() => parseTemplate("{nope}")).toThrow("Unknown token {nope}");
    expect(() => parseTemplate("{date")).toThrow("Unclosed");
    expect(() => parseTemplate("date}")).toThrow("Unexpected");
    expect(() => parseTemplate("{date:4}")).toThrow("Only {seq}");
    expect(validateTemplate("{date}_{seq:3}")).toBeNull();
    expect(validateTemplate("{x}")).toContain("Unknown token");
  });
});

describe("sanitizeSegment", () => {
  test("cleans names for APFS, NTFS and exFAT", () => {
    expect(sanitizeSegment('a<b>c:d"e|f?g*h')).toBe("a_b_c_d_e_f_g_h");
    expect(sanitizeSegment("trailing dots... ")).toBe("trailing dots");
    expect(sanitizeSegment("CON")).toBe("_CON");
    expect(sanitizeSegment("lpt1.txt")).toBe("_lpt1.txt");
    expect(sanitizeSegment("tab\there\nnewline")).toBe("tab_here_newline");
    expect(sanitizeSegment("x".repeat(300))).toHaveLength(200);
  });
});

describe("cameraParts", () => {
  test("reads the engine's make|model|serial key", () => {
    expect(cameraParts("Canon|Canon EOS R3|0123")).toEqual({
      make: "Canon",
      model: "Canon EOS R3",
      serial: "0123",
    });
    expect(cameraParts("NIKON CORPORATION|NIKON Z 9")).toMatchObject({ model: "NIKON Z 9" });
    expect(cameraParts(undefined)).toEqual({ make: "", model: "", serial: "" });
  });
});
