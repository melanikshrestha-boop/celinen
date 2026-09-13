import { cloneDevelopSettings, DEVELOP_ENGINE_LIMITS, type DevelopSettings } from "./contract";
import { isNeutralDevelopRecipe } from "./neutral";
import { assertBrowserDevelopSettingsSupported } from "./browser-capabilities";

export const BROWSER_DEVELOP_ENGINE = "foto-develop-browser-1";

function clamp(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function linear(v: number) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function srgb(v: number) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Color-only entry point. Geometry belongs to renderDevelopInBrowser; reject it
 * here so direct callers cannot mistake an unchanged crop for a complete edit.
 */
export function applyDevelopRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  settings: DevelopSettings,
) {
  assertBrowserDevelopSettingsSupported(settings);
  const crop = settings.crop;
  if (
    crop.x !== 0 ||
    crop.y !== 0 ||
    crop.width !== 1 ||
    crop.height !== 1 ||
    crop.rotate !== 0 ||
    crop.flipX ||
    crop.flipY
  )
    throw new Error("Crop, rotate and flip require the full browser renderer.");
  applySupportedDevelopRgba(rgba, width, height, settings);
}

/** Same source LUT as native `source_values`: exposure in linear, then temp/tint.
 * Only called after checking the complete recipe's browser capabilities.
 */
function applySupportedDevelopRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  settings: DevelopSettings,
) {
  if (rgba.length !== width * height * 4) throw new Error("Invalid Develop image.");
  if (isNeutralDevelopRecipe(settings)) return;
  const exposure = Math.pow(2, settings.exposure);
  const table = new Float32Array(256 * 3);
  for (let code = 0; code < 256; code++) {
    let r = code / 255,
      g = code / 255,
      b = code / 255;
    if (settings.exposure !== 0) {
      r = clamp(srgb(linear(r) * exposure));
      g = clamp(srgb(linear(g) * exposure));
      b = clamp(srgb(linear(b) * exposure));
    }
    if (settings.temperature !== 0 || settings.tint !== 0) {
      const t = settings.temperature,
        tint = settings.tint;
      r = clamp(r * Math.pow(2, t * 0.0035 + tint * 0.001));
      g = clamp(g * Math.pow(2, -tint * 0.002));
      b = clamp(b * Math.pow(2, -t * 0.0035 + tint * 0.001));
    }
    table[code * 3] = r;
    table[code * 3 + 1] = g;
    table[code * 3 + 2] = b;
  }
  const useTone =
    settings.contrast !== 0 ||
    settings.highlights !== 0 ||
    settings.shadows !== 0 ||
    settings.whites !== 0 ||
    settings.blacks !== 0 ||
    settings.dehaze !== 0;
  for (let i = 0; i < rgba.length; i += 4) {
    // Independent channel LUT: native maps each source channel through the same 256-entry table.
    let r = table[rgba[i]! * 3]!,
      g = table[rgba[i + 1]! * 3 + 1]!,
      b = table[rgba[i + 2]! * 3 + 2]!;
    if (useTone) {
      const lum = luma(r, g, b);
      const lo = (1 - lum) * (1 - lum);
      const hi = lum * lum;
      const shift =
        settings.shadows * 0.0025 * lo +
        settings.highlights * 0.0025 * hi +
        settings.blacks * 0.0015 * Math.pow(1 - lum, 5) +
        settings.whites * 0.0015 * Math.pow(lum, 5);
      const contrast = 1 + settings.contrast * 0.008;
      const dehaze = settings.dehaze;
      const remap = (v: number) => {
        let value = (v + shift - 0.5) * contrast + 0.5;
        value = (value - dehaze * 0.0015) / (1 - dehaze * 0.0025);
        return clamp(value);
      };
      r = remap(r);
      g = remap(g);
      b = remap(b);
    }
    if (settings.saturation !== 0 || settings.vibrance !== 0) {
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const amount = Math.max(
        0,
        1 + settings.saturation * 0.01 + settings.vibrance * 0.01 * (1 - spread),
      );
      const y = luma(r, g, b);
      r = clamp(y + (r - y) * amount);
      g = clamp(y + (g - y) * amount);
      b = clamp(y + (b - y) * amount);
    }
    rgba[i] = Math.round(r * 255);
    rgba[i + 1] = Math.round(g * 255);
    rgba[i + 2] = Math.round(b * 255);
  }
}

function cropCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  crop: DevelopSettings["crop"],
) {
  const identity =
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === 1 &&
    crop.height === 1 &&
    crop.angle === 0 &&
    crop.rotate === 0 &&
    !crop.flipX &&
    !crop.flipY;
  if (identity) return { width, height };
  const cw = Math.max(1, Math.round(width * crop.width));
  const ch = Math.max(1, Math.round(height * crop.height));
  const swap = crop.rotate === 90 || crop.rotate === 270;
  const outW = swap ? ch : cw;
  const outH = swap ? cw : ch;
  const src = ctx.getImageData(
    Math.round(crop.x * width),
    Math.round(crop.y * height),
    Math.min(cw, width),
    Math.min(ch, height),
  );
  const out = ctx.createImageData(outW, outH);
  // Rotate/flip in source crop space. The capability guard rejects straighten.
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      let u = x,
        v = y;
      if (crop.flipX) u = src.width - 1 - u;
      if (crop.flipY) v = src.height - 1 - v;
      let dx = u,
        dy = v;
      if (crop.rotate === 90) {
        dx = v;
        dy = src.width - 1 - u;
      } else if (crop.rotate === 180) {
        dx = src.width - 1 - u;
        dy = src.height - 1 - v;
      } else if (crop.rotate === 270) {
        dx = src.height - 1 - v;
        dy = u;
      }
      const si = (y * src.width + x) * 4;
      const di = (dy * outW + dx) * 4;
      out.data[di] = src.data[si]!;
      out.data[di + 1] = src.data[si + 1]!;
      out.data[di + 2] = src.data[si + 2]!;
      out.data[di + 3] = src.data[si + 3]!;
    }
  }
  ctx.canvas.width = outW;
  ctx.canvas.height = outH;
  ctx.putImageData(out, 0, 0);
  return { width: outW, height: outH };
}

export async function renderDevelopInBrowser(
  source: Blob,
  settings: DevelopSettings,
  options: { edge: number; quality: number; signal?: AbortSignal } = {
    edge: DEVELOP_ENGINE_LIMITS.previewEdge,
    quality: 0.9,
  },
): Promise<Blob> {
  options.signal?.throwIfAborted();
  const recipe = cloneDevelopSettings(settings);
  assertBrowserDevelopSettingsSupported(recipe);
  const bitmap = await createImageBitmap(source);
  try {
    options.signal?.throwIfAborted();
    const scale = Math.min(1, options.edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Develop could not open a drawing surface.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    applySupportedDevelopRgba(image.data, width, height, recipe);
    ctx.putImageData(image, 0, 0);
    cropCanvas(ctx, width, height, recipe.crop);
    options.signal?.throwIfAborted();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", options.quality),
    );
    if (!blob || blob.size < 4) throw new Error("Develop returned an incomplete image.");
    return blob;
  } finally {
    bitmap.close();
  }
}
