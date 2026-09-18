/// <reference lib="webworker" />
/** The RAW converter, off the main thread.
 *
 * A 24-million-pixel decode is about a second of solid arithmetic, which is a
 * second of frozen interface if it happens on the page. It happens here
 * instead, one band at a time, yielding to the event loop between bands so a
 * cancel message can actually be delivered — the C++ cannot be interrupted
 * mid-band, but a band is a few milliseconds.
 */
import { instantiateRawDecodeWasm, type RawDecodeEngine } from "./raw-decode-engine";
import type { RawDecodeReply, RawDecodeRequest } from "./raw-decode-messages";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: Promise<RawDecodeEngine> | null = null;
function loadEngine() {
  engine ??= fetch(new URL("./celinen-raw-decode.wasm", import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`RAW decoder download failed (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(instantiateRawDecodeWasm);
  return engine;
}

const cancelled = new Set<number>();
let running = false;
const queue: Extract<RawDecodeRequest, { kind: "decode" }>[] = [];

/** Lets the event loop run, so a cancel posted mid-decode is seen. */
const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function decode(job: Extract<RawDecodeRequest, { kind: "decode" }>) {
  const wasm = await loadEngine();
  if (cancelled.delete(job.id)) return { id: job.id, kind: "cancelled" } as const;
  const file = new Uint8Array(job.file);
  const description = wasm.open(file);
  if (!description) {
    // Not a failure of ours: this camera or this packing is one we do not read,
    // and the page keeps the embedded JPEG it is already showing.
    return {
      id: job.id,
      kind: "unsupported",
      reason: wasm.lastError() || "This RAW's sensor data could not be read.",
    } as const;
  }
  const size = wasm.begin(job.request);
  scope.postMessage({ id: job.id, kind: "opened", description, ...size } satisfies RawDecodeReply);

  let progress = 0;
  let lastPosted = -1;
  while (progress < 1) {
    if (cancelled.delete(job.id)) {
      wasm.release();
      return { id: job.id, kind: "cancelled" } as const;
    }
    progress = wasm.step();
    // A message per band would be thousands on a large frame; a percent is
    // what a progress bar can actually show.
    const percent = Math.floor(progress * 100);
    if (percent !== lastPosted) {
      lastPosted = percent;
      scope.postMessage({ id: job.id, kind: "progress", progress } satisfies RawDecodeReply);
    }
    await yieldToEvents();
  }
  const result = wasm.finish();
  const residentBytes = wasm.residentBytes();
  wasm.release();
  return {
    id: job.id,
    kind: "decoded",
    width: result.width,
    height: result.height,
    rgba: result.rgba,
    kelvin: result.kelvin,
    tint: result.tint,
    whiteBalanceFromFile: result.whiteBalanceFromFile,
    description,
    residentBytes,
  } as const;
}

async function pump() {
  if (running) return;
  running = true;
  for (let job = queue.shift(); job; job = queue.shift()) {
    let reply: RawDecodeReply;
    try {
      reply = await decode(job);
    } catch (error) {
      cancelled.delete(job.id);
      try {
        (await loadEngine()).release();
      } catch {
        // The engine never loaded; there is nothing to hand back.
      }
      reply = {
        id: job.id,
        kind: "failed",
        error: error instanceof Error ? error.message : "This RAW could not be decoded.",
      };
    }
    // The pixels are the only large thing crossing back; transfer, never copy.
    scope.postMessage(reply, reply.kind === "decoded" ? [reply.rgba.buffer] : []);
  }
  running = false;
}

scope.onmessage = ({ data }: MessageEvent<RawDecodeRequest>) => {
  if (data.kind === "cancel") {
    cancelled.add(data.id);
    return;
  }
  queue.push(data);
  void pump();
};
