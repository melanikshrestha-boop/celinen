/** Page-side preparation of social JPEGs: Instagram feed sizes and the 9:16
 * story size. The browser decodes (it already did the develop render); C++
 * frames and encodes. There is one framing implementation, in native/src/social.cpp.
 */
import {
  INSTAGRAM_FEED_FORMATS,
  INSTAGRAM_IMAGE_BYTES,
  jpegDimensions,
  sha256Hex,
  type InstagramPostItem,
} from "./instagram-post";
import { STORY_FORMAT, STORY_IMAGE_BYTES, type StoryItem } from "./story-broadcast";
import {
  instantiateSocialWasm,
  type FeedFrame,
  type SocialFormat,
  type SocialWasmEngine,
} from "./wasm/engine";

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

/** Every geometry the engine produces, with the byte limit that governs it. */
export const SOCIAL_FORMATS: Record<
  SocialFormat,
  { width: number; height: number; label: string; bytes: number }
> = {
  portrait: { ...INSTAGRAM_FEED_FORMATS.portrait, bytes: INSTAGRAM_IMAGE_BYTES },
  square: { ...INSTAGRAM_FEED_FORMATS.square, bytes: INSTAGRAM_IMAGE_BYTES },
  story: { ...STORY_FORMAT, bytes: STORY_IMAGE_BYTES },
};

export type FramedPhoto = InstagramPostItem & { blob: Blob };
export type FramedStory = StoryItem & { blob: Blob };

/** Decodes at a working size, frames in C++, and checks what came back against
 * the geometry that was asked for. The caller never trusts the engine blindly:
 * these bytes are what a platform will fetch and what the hash is taken over. */
async function frameSocial(source: Blob, frame: FeedFrame, signal?: AbortSignal) {
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
  const expected = SOCIAL_FORMATS[frame.format];
  if (
    !size ||
    size.width !== expected.width ||
    size.height !== expected.height ||
    jpeg.byteLength > expected.bytes
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

export async function frameForInstagram(
  source: Blob,
  frame: FeedFrame & { format: "portrait" | "square" },
  signal?: AbortSignal,
): Promise<FramedPhoto> {
  return frameSocial(source, frame, signal);
}

/** 1080x1920, the size both Instagram and Facebook stories want. */
export async function frameForStory(
  source: Blob,
  frame: Omit<FeedFrame, "format">,
  signal?: AbortSignal,
): Promise<FramedStory> {
  const framed = await frameSocial(source, { ...frame, format: "story" }, signal);
  return {
    blob: framed.blob,
    sha256: framed.sha256,
    bytes: framed.bytes,
    width: STORY_FORMAT.width,
    height: STORY_FORMAT.height,
  };
}
