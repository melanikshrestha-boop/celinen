/// <reference lib="webworker" />
/** One lane of the ingest pool. It holds its own copy of the C++ engine and
 * reads whole files: the page never decodes a photo, so a card of ten thousand
 * frames leaves the interface responsive the entire time.
 */
import { instantiateIngestWasm, type IngestEngine } from "./ingest-engine";
import type { IngestReply, IngestRequest } from "./ingest-messages";
import { embeddedJpeg } from "./raw-preview";

const scope = self as unknown as DedicatedWorkerGlobalScope;

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
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      const jpeg = embeddedJpeg(bytes);
      if (!jpeg)
        throw new Error("This file holds no readable preview. Export a JPEG and import that.");
      bytes = jpeg;
    }
    const result = wasm.read(bytes, options ?? {});
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
