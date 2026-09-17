/// <reference lib="webworker" />
import { instantiateDevelopWasm, type DevelopWasmEngine } from "./engine";
import type { DevelopWasmReply, DevelopWasmRequest } from "./messages";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: Promise<DevelopWasmEngine> | null = null;
function loadEngine() {
  engine ??= fetch(new URL("./celinen-develop.wasm", import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`Develop engine download failed (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(instantiateDevelopWasm);
  return engine;
}

// The C++ instance retains exactly one decoded source. `loadedKey` names it so a
// slider drag re-sends only the recipe; pixels cross the boundary once per photo.
let loadedKey: string | null = null;
const cancelled = new Set<number>();
const queue: DevelopWasmRequest[] = [];
let running = false;

function loadSource(wasm: DevelopWasmEngine, key: string, bitmap: ImageBitmap, edge: number) {
  try {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("Develop could not open a drawing surface.");
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    loadedKey = null;
    wasm.source(width, height).set(pixels);
    loadedKey = key;
    canvas.width = canvas.height = 0;
  } finally {
    bitmap.close();
  }
}

async function run(
  job: Exclude<DevelopWasmRequest, { kind: "cancel" }>,
): Promise<DevelopWasmReply> {
  const wasm = await loadEngine();
  if (job.kind === "probe") return { id: job.id, kind: "ready", version: wasm.version };
  // Load even for a cancelled job: the page already believes these pixels are
  // resident, and skipping would cost a full round trip on the next render.
  if (job.bitmap) loadSource(wasm, job.sourceKey, job.bitmap, job.edge);
  if (cancelled.delete(job.id)) return { id: job.id, kind: "cancelled" };
  if (loadedKey !== job.sourceKey) return { id: job.id, kind: "need-source" };
  if (job.kind === "suggest") return { id: job.id, kind: "suggestion", suggestion: wasm.suggest() };
  if (job.kind === "look-describe")
    return { id: job.id, kind: "look", descriptor: wasm.describeLook() };
  if (job.kind === "look-match")
    return {
      id: job.id,
      kind: "look-matched",
      match: wasm.matchLook(job.looks, job.settings, job.outputEdge),
    };
  const image = wasm.develop(job.settings, job.edge > 4096);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!context) throw new Error("Develop could not open a drawing surface.");
  context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: job.quality });
  canvas.width = canvas.height = 0;
  if (blob.size < 4) throw new Error("Develop returned an incomplete image.");
  return { id: job.id, kind: "rendered", blob };
}

async function pump() {
  if (running) return;
  running = true;
  for (let job = queue.shift(); job; job = queue.shift()) {
    if (job.kind === "cancel") continue;
    let reply: DevelopWasmReply;
    try {
      reply = await run(job);
    } catch (error) {
      cancelled.delete(job.id);
      reply = {
        id: job.id,
        kind: "failed",
        error: error instanceof Error ? error.message : "Develop failed.",
        // A failed engine load is permanent for this page; a failed render is not.
        fatal: job.kind === "probe",
      };
    }
    scope.postMessage(reply);
  }
  running = false;
}

scope.onmessage = ({ data }: MessageEvent<DevelopWasmRequest>) => {
  if (data.kind === "cancel") {
    // Only a job that is still waiting can be skipped; C++ cannot be interrupted.
    if (queue.some((job) => job.kind !== "cancel" && job.id === data.id)) cancelled.add(data.id);
    return;
  }
  queue.push(data);
  void pump();
};
