/** Page-side driver for the C++ Develop engine compiled to WebAssembly.
 * One worker, one engine instance. The page decodes a photo once, transfers the
 * bitmap, and afterwards sends only recipe text for that photo.
 */
import type { DevelopSettings } from "../contract";
import { decodeDevelopPreview } from "../decode-preview";
import { LOOK_SOURCE_EDGE, type LookDescriptor, type LookMatchResult } from "../look-match";
import type { DevelopAutoSuggestion } from "./engine";
import type { DevelopWasmReply, DevelopWasmRequest } from "./messages";

export const WASM_DEVELOP_ENGINE = "celinen-develop-wasm-1";

type Settled = Exclude<DevelopWasmReply, { kind: "failed" }>;
type Waiter = { resolve: (reply: Settled) => void; reject: (error: Error) => void };
// `Omit` over a union keeps only shared keys; distribute it per message kind.
type Unsent<T = DevelopWasmRequest> = T extends { id: number } ? Omit<T, "id"> : never;

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let nextId = 1;
const waiting = new Map<number, Waiter>();
/** What the worker's engine will hold once every posted job has run. */
let residentKey: string | null = null;
const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 1;

function supported() {
  return (
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

function retire(error: Error) {
  worker?.terminate();
  worker = null;
  residentKey = null;
  for (const waiter of waiting.values()) waiter.reject(error);
  waiting.clear();
}

function post(
  message: Unsent,
  transfer: Transferable[] = [],
): { id: number; reply: Promise<Settled> } {
  const id = nextId++;
  const reply = new Promise<Settled>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
  });
  worker!.postMessage({ ...message, id } as DevelopWasmRequest, transfer);
  return { id, reply };
}

/** False when this browser cannot run the engine (no worker canvas, blocked
 * WebAssembly, failed download). Callers then keep the basic script renderer.
 * Settles once per page; a crashed worker is not resurrected mid-session.
 */
export function developWasmReady(): Promise<boolean> {
  ready ??= (async () => {
    if (!supported()) return false;
    try {
      worker = new Worker(new URL("./develop.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<DevelopWasmReply>) => {
        const waiter = waiting.get(data.id);
        if (!waiter) return;
        waiting.delete(data.id);
        if (data.kind === "failed") waiter.reject(new Error(data.error));
        else waiter.resolve(data);
      };
      worker.onerror = () => retire(new Error("The Develop engine stopped."));
      worker.onmessageerror = () => retire(new Error("The Develop engine stopped."));
      const { reply } = post({ kind: "probe" });
      return (await reply).kind === "ready";
    } catch {
      retire(new Error("The Develop engine is unavailable."));
      return false;
    }
  })();
  return ready;
}

function keyFor(source: Blob, edge: number) {
  let id = blobIds.get(source);
  if (!id) blobIds.set(source, (id = nextBlobId++));
  return `${id}:${edge}`;
}

async function submit(
  source: Blob,
  edge: number,
  job: (base: { sourceKey: string; edge: number; bitmap?: ImageBitmap }) => Unsent,
  signal?: AbortSignal,
): Promise<Settled> {
  if (!(await developWasmReady()) || !worker) throw new Error("The Develop engine is unavailable.");
  const sourceKey = keyFor(source, edge);
  // Second pass only when the worker reports its resident source was displaced
  // by another job between our bookkeeping and its turn in the queue.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const bitmap =
      attempt || residentKey !== sourceKey ? await decodeDevelopPreview(source) : undefined;
    if (signal?.aborted || !worker) {
      bitmap?.close();
      signal?.throwIfAborted();
      throw new Error("The Develop engine stopped.");
    }
    if (bitmap) residentKey = sourceKey;
    const { id, reply } = post(
      job({ sourceKey, edge, ...(bitmap ? { bitmap } : {}) }),
      bitmap ? [bitmap] : [],
    );
    const abort = () => worker?.postMessage({ id, kind: "cancel" } satisfies DevelopWasmRequest);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const settled = await reply;
      signal?.throwIfAborted();
      if (settled.kind !== "need-source") return settled;
      residentKey = null;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  throw new Error("Develop could not load this photo.");
}

export async function renderDevelopWasm(
  source: Blob,
  settings: DevelopSettings,
  options: { edge: number; quality: number; signal?: AbortSignal },
): Promise<Blob> {
  const settled = await submit(
    source,
    options.edge,
    (base) => ({ ...base, kind: "render", settings, quality: options.quality }),
    options.signal,
  );
  if (settled.kind !== "rendered")
    throw new DOMException("Develop render cancelled.", "AbortError");
  return settled.blob;
}

/** Measure an inspiration photo's look. Throws when the engine is unavailable. */
export async function describeLookWasm(
  source: Blob,
  signal?: AbortSignal,
): Promise<LookDescriptor> {
  const settled = await submit(
    source,
    LOOK_SOURCE_EDGE,
    (base) => ({ ...base, kind: "look-describe" }),
    signal,
  );
  if (settled.kind !== "look") throw new DOMException("Look measurement cancelled.", "AbortError");
  return settled.descriptor;
}

/** Solve this photo's own recipe for the combined look of `looks`. */
export async function matchLookWasm(
  source: Blob,
  looks: LookDescriptor[],
  settings: DevelopSettings,
  options: { outputEdge: number; signal?: AbortSignal },
): Promise<LookMatchResult> {
  const settled = await submit(
    source,
    LOOK_SOURCE_EDGE,
    (base) => ({ ...base, kind: "look-match", looks, settings, outputEdge: options.outputEdge }),
    options.signal,
  );
  if (settled.kind !== "look-matched")
    throw new DOMException("Look match cancelled.", "AbortError");
  return settled.match;
}

/** Measured Auto for the photo's working pixels. Null when the engine is unavailable. */
export async function suggestDevelopWasm(
  source: Blob,
  edge: number,
  signal?: AbortSignal,
): Promise<DevelopAutoSuggestion | null> {
  if (!(await developWasmReady())) return null;
  const settled = await submit(source, edge, (base) => ({ ...base, kind: "suggest" }), signal);
  return settled.kind === "suggestion" ? settled.suggestion : null;
}
