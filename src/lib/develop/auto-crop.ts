import { z } from "zod";
import { developSettingsSchema } from "./contract";

export const AUTO_CROP_EDGE = 384;
export const AUTO_CROP_MAX_BYTES = 16 + AUTO_CROP_EDGE * AUTO_CROP_EDGE * 4;
const aspectSchema = z.number().finite().min(0.25).max(4).nullable();
const unit = z.number().finite().min(0).max(1);
export const autoCropResultSchema = z
  .object({
    crop: developSettingsSchema.shape.crop,
    confidence: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string().min(1).max(200)).min(1).max(8),
    analysis: z
      .object({
        width: z.number().int().min(16).max(AUTO_CROP_EDGE),
        height: z.number().int().min(16).max(AUTO_CROP_EDGE),
        horizonAngle: z.number().finite().min(-8).max(8),
        horizonCoverage: unit,
        saliencyRetained: unit,
        retainedArea: z.number().finite().min(0.7).max(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    const crop = result.crop;
    const radians = (crop.angle * Math.PI) / 180;
    const width = crop.width * result.analysis.width,
      height = crop.height * result.analysis.height;
    const scale = Math.max(
      Math.abs(Math.cos(radians)) + (Math.abs(Math.sin(radians)) * height) / width,
      Math.abs(Math.cos(radians)) + (Math.abs(Math.sin(radians)) * width) / height,
    );
    if (
      crop.rotate !== 0 ||
      crop.flipX ||
      crop.flipY ||
      Math.abs(crop.angle) > 8 ||
      crop.width * crop.height < 0.7 ||
      Math.abs((crop.width * crop.height) / (scale * scale) - result.analysis.retainedArea) > 1e-6
    )
      context.addIssue({ code: "custom", message: "Crop proposal exceeds conservative bounds." });
  });
export type AutoCropResult = z.infer<typeof autoCropResultSchema>;

/** Immutable raw-pixel packet; no filenames, file paths or source edits. */
export function encodeCropPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  aspect: number | null = null,
): Uint8Array<ArrayBuffer> {
  aspectSchema.parse(aspect);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > AUTO_CROP_EDGE ||
    height > AUTO_CROP_EDGE ||
    pixels.length !== width * height * 4
  )
    throw new Error("Crop analysis needs a 16–384 pixel preview.");
  const packet = new Uint8Array(16 + pixels.length),
    view = new DataView(packet.buffer);
  view.setUint32(0, 0x46433031);
  view.setUint32(4, width);
  view.setUint32(8, height);
  view.setFloat32(12, aspect ?? 0);
  packet.set(pixels, 16);
  return packet;
}

export async function suggestAutoCrop(
  neutralPreview: Blob,
  options: { aspect: number | null } = { aspect: null },
  signal?: AbortSignal,
): Promise<AutoCropResult> {
  const aspect = aspectSchema.parse(options.aspect);
  signal?.throwIfAborted();
  if (
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
    throw new Error("Automatic crop requires the local C++ engine.");
  if (!neutralPreview.size || neutralPreview.size > 32 * 1024 * 1024)
    throw new Error("Use a bounded neutral preview for automatic crop.");
  const bitmap = await createImageBitmap(neutralPreview);
  let body: Uint8Array<ArrayBuffer>;
  try {
    signal?.throwIfAborted();
    const scale = Math.min(1, AUTO_CROP_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale),
      height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The neutral preview could not be read.");
    context.drawImage(bitmap, 0, 0, width, height);
    body = encodeCropPixels(context.getImageData(0, 0, width, height).data, width, height, aspect);
  } finally {
    bitmap.close();
  }
  const deadline = AbortSignal.timeout(20_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 0; attempt < 2; attempt++) {
    requestSignal.throwIfAborted();
    const status = await fetch("/__crop/status", {
      headers: { "x-lenslabs-request": "studio" },
      cache: "no-store",
      signal: requestSignal,
    });
    if (!status.ok) throw new Error("The local C++ crop engine is unavailable.");
    const capability = z
      .object({
        ready: z.boolean(),
        token: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
      .parse(await status.json());
    if (!capability.ready || !capability.token)
      throw new Error("Rebuild the local C++ engine to enable automatic crop.");
    const response = await fetch("/__crop/suggest", {
      method: "POST",
      cache: "no-store",
      signal: requestSignal,
      headers: {
        "content-type": "application/x-foto-crop",
        "x-lenslabs-request": "studio",
        "x-lenslabs-token": capability.token,
      },
      body,
    });
    requestSignal.throwIfAborted();
    if (response.status === 403 && attempt === 0) continue;
    if (!response.ok) {
      if (response.status === 429)
        throw new Error("A crop preview is already processing. Try again shortly.");
      throw new Error("Crop analysis failed. The original photo and edits are unchanged.");
    }
    const size = Number(response.headers.get("content-length"));
    if (
      !Number.isSafeInteger(size) ||
      size < 2 ||
      size > 16 * 1024 ||
      response.headers.get("content-type") !== "application/json" ||
      response.headers.get("x-foto-engine") !== "cpp-crop-1"
    )
      throw new Error("Invalid crop analysis receipt.");
    const text = await response.text();
    requestSignal.throwIfAborted();
    if (new TextEncoder().encode(text).length !== size)
      throw new Error("Incomplete crop analysis receipt.");
    const result = autoCropResultSchema.parse(JSON.parse(text));
    const packet = new DataView(body.buffer);
    if (
      result.analysis.width !== packet.getUint32(4) ||
      result.analysis.height !== packet.getUint32(8)
    )
      throw new Error("Crop analysis belongs to a different preview.");
    return result;
  }
  throw new Error("The local crop session expired. Try again.");
}
