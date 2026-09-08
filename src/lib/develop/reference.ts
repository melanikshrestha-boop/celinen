import { z } from "zod";
import { defaultDevelopSettings } from "./contract";
import { renderDevelop } from "./client";
import {
  assertReferenceAspect,
  encodeReferencePair,
  referencePreviewSize,
  referenceResultSchema,
  type ReferenceFitResult,
} from "./reference-contract";

const statusSchema = z.object({
  ready: z.boolean(),
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
/** The first Blob must be an unedited native render of the selected original, never its current preview. */
export async function fitReferenceLook(
  neutralOriginal: Blob,
  editedReference: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<ReferenceFitResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
    throw new Error("Reference fitting requires the local C++ app.");
  const statusResponse = await fetch("/__reference/status", {
    headers: { "x-lenslabs-request": "studio" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!statusResponse.ok)
    throw new Error(
      "The local reference fitter is unavailable. Rebuild the C++ engine and reopen Develop.",
    );
  const status = statusSchema.parse(await statusResponse.json());
  if (!status.ready || !status.token)
    throw new Error(
      "The local reference fitter is unavailable. Run make -C native and reopen Develop.",
    );
  // Native decoding bounds memory/edge before browser bitmap allocation and resolves EXIF orientation.
  // The selected RAW must already have been explicitly rendered in RAW mode by the caller.
  const originalPreview = await renderDevelop(neutralOriginal, defaultDevelopSettings(), {
    edge: 256,
    quality: 1,
    ...(signal ? { signal } : {}),
  });
  const editedPreview = await renderDevelop(editedReference, defaultDevelopSettings(), {
    edge: 256,
    quality: 1,
    ...(signal ? { signal } : {}),
  });
  signal?.throwIfAborted();
  const source = await createImageBitmap(originalPreview);
  let target: ImageBitmap | null = null;
  try {
    target = await createImageBitmap(editedPreview);
    signal?.throwIfAborted();
    assertReferenceAspect(source, target);
    const { width, height } = referencePreviewSize(source.width, source.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!context) throw new Error("Reference preview could not be prepared.");
    const pixels = (image: ImageBitmap) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return new Uint8Array(context.getImageData(0, 0, width, height).data);
    };
    const body = encodeReferencePair(width, height, pixels(source), pixels(target));
    const response = await fetch("/__reference/fit", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/x-foto-reference",
        "x-lenslabs-request": "studio",
        "x-lenslabs-token": status.token,
      },
      body,
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    if (!response.ok) {
      let message = `Reference fit failed (${response.status}).`;
      try {
        const error: unknown = await response.json();
        if (
          error &&
          typeof error === "object" &&
          "error" in error &&
          typeof error.error === "string"
        )
          message = error.error;
      } catch {
        /* Retain fallback. */
      }
      throw new Error(message);
    }
    const length = Number(response.headers.get("content-length"));
    if (
      !Number.isSafeInteger(length) ||
      length < 2 ||
      length > 16 * 1024 ||
      response.headers.get("content-type") !== "application/json"
    )
      throw new Error("Invalid reference fit receipt.");
    const raw = await response.text();
    signal?.throwIfAborted();
    if (new TextEncoder().encode(raw).length !== length)
      throw new Error("Incomplete reference fit receipt.");
    return referenceResultSchema.parse(JSON.parse(raw));
  } finally {
    source.close();
    target?.close();
  }
}
