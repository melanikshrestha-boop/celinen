/// <reference lib="webworker" />
/** One lane of the ingest pool. It holds its own copy of the C++ engine and
 * reads whole files: the page never decodes a photo, so a card of ten thousand
 * frames leaves the interface responsive the entire time.
 */
import { instantiateIngestWasm, type IngestEngine } from "./ingest-engine";
import type { IngestReply, IngestRequest } from "./ingest-messages";
import { embeddedJpeg } from "./raw-preview";

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** How much of a RAW the engine gets to read the camera's AF area from. TIFF
 * RAWs and CR3 put their IFDs and maker note ahead of the image data, well
 * inside this; the cap keeps a 60 MB file from being copied into wasm twice.
 * Anything the cap cuts off is read as "no AF area", never as garbage. */
const RAW_METADATA_BYTES = 8 * 1024 * 1024;

let engine: Promise<IngestEngine> | null = null;
function load() {
  engine ??= fetch(new URL("./celinen-ingest.wasm", import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`Cull engine download failed (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(instantiateIngestWasm);
  return engine;
}

scope.onmessage = async ({ data }: MessageEvent<IngestRequest>) => {
  const { id, file, options } = data;
  try {
    const wasm = await load();
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(await file.arrayBuffer());
    let container: Uint8Array<ArrayBufferLike> | undefined;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      const jpeg = embeddedJpeg(bytes);
      if (!jpeg)
        throw new Error("This file holds no readable preview. Export a JPEG and import that.");
      // The embedded preview rarely carries the maker note; the RAW does.
      container = bytes.subarray(0, Math.min(bytes.length, RAW_METADATA_BYTES));
      bytes = jpeg;
    }
    const result = wasm.read(bytes, options ?? {}, container);
    const reply: IngestReply = {
      id,
      kind: "read",
      reading: result.reading,
      width: result.width,
      height: result.height,
      captureTimeMs: result.captureTimeMs,
      captureTimeBasis: result.captureTimeBasis,
      cameraKey: result.cameraKey,
      thumbnail: result.thumbnail,
      ...(result.afPoint
        ? { afPoint: result.afPoint, afConfirmed: result.afConfirmed, focusHit: result.focusHit }
        : {}),
    };
    scope.postMessage(reply);
  } catch (error) {
    scope.postMessage({
      id,
      kind: "failed",
      error: error instanceof Error ? error.message : "This photo could not be read.",
    } satisfies IngestReply);
  }
};
