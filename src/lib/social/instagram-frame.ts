/** Page-side preparation of Instagram feed JPEGs.
 * The browser decodes (it already did the develop render); C++ frames and encodes.
 */
import {
  INSTAGRAM_FEED_FORMATS,
  INSTAGRAM_IMAGE_BYTES,
  jpegDimensions,
  sha256Hex,
  type InstagramPostItem,
} from "./instagram-post";
import { instantiateSocialWasm, type FeedFrame, type SocialWasmEngine } from "./wasm/engine";

let pending: Promise<SocialWasmEngine> | null = null;
function socialEngine() {
  pending ??= (async () => {
    if (typeof WebAssembly === "undefined")
      throw new Error("This browser cannot run the framing engine.");
    // Lazy URL inside a function: SSR and bun test never evaluate it.
    const response = await fetch(new URL("./wasm/celinen-social.wasm", import.meta.url));
    if (!response.ok) throw new Error("The framing engine could not be downloaded.");
    return instantiateSocialWasm(await response.arrayBuffer());
  })().catch((error: unknown) => {
    pending = null; // a dropped connection must not disable posting for the session
    throw error;
  });
  return pending;
}

/** Enough source pixels for a sharp 1080px frame at 3× zoom, without 45 MP in wasm memory. */
const WORKING_EDGE = 3240;

export type FramedPhoto = InstagramPostItem & { blob: Blob };

export async function frameForInstagram(
  source: Blob,
  frame: FeedFrame,
  signal?: AbortSignal,
): Promise<FramedPhoto> {
  const engine = await socialEngine();
  signal?.throwIfAborted();
  const probe = await createImageBitmap(source, { imageOrientation: "from-image" });
  const scale = Math.min(1, WORKING_EDGE / Math.max(probe.width, probe.height));
  let bitmap = probe;
  if (scale < 1) {
    bitmap = await createImageBitmap(source, {
      imageOrientation: "from-image",
      resizeWidth: Math.max(1, Math.round(probe.width * scale)),
      resizeHeight: Math.max(1, Math.round(probe.height * scale)),
      resizeQuality: "high",
    });
    probe.close();
  }
  let pixels: ImageData;
  try {
    signal?.throwIfAborted();
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("This browser cannot prepare photos.");
    context.drawImage(bitmap, 0, 0);
    pixels = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "srgb" });
  } finally {
    bitmap.close();
  }
  const jpeg = engine.frame(pixels.data, pixels.width, pixels.height, frame);
  const size = jpegDimensions(jpeg);
  const expected = INSTAGRAM_FEED_FORMATS[frame.format];
  if (
    !size ||
    size.width !== expected.width ||
    size.height !== expected.height ||
    jpeg.byteLength > INSTAGRAM_IMAGE_BYTES
  )
    throw new Error("The framing engine returned an invalid photo.");
  return {
    blob: new Blob([jpeg], { type: "image/jpeg" }),
    sha256: await sha256Hex(jpeg),
    bytes: jpeg.byteLength,
    width: size.width,
    height: size.height,
  };
}
