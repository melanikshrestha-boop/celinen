/// <reference lib="webworker" />
/** One lane of the ingest pool. It holds its own copy of the C++ engine and
 * reads whole files: the page never decodes a photo on the main thread, so a
 * card of ten thousand frames leaves the interface responsive the entire time.
 *
 * Which decoder reads which file is decided in readPhoto(): the engine for
 * JPEGs and RAW previews, the browser's own decoder for everything else.
 */
import { instantiateIngestWasm, type IngestEngine } from "./ingest-engine";
import type { IngestReply, IngestRequest } from "./ingest-messages";
import { browserPixels, readPhoto } from "./ingest-read";

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
    const result = await readPhoto(file, options ?? {}, {
      engine: wasm,
      decodePixels: browserPixels,
    });
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
      ...(result.damaged ? { damaged: result.damaged } : {}),
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
