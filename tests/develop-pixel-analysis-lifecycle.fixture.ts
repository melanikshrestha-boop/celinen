// Isolated browser-API harness for the actual worker and fallback functions.
// It verifies cleanup/lifecycle, not browser image codecs (covered by live QA).
import { analyzeDevelopPixels, clippingPixels } from "../src/lib/develop/histogram";
import type { PixelAnalysisReply } from "../src/lib/develop/pixel-analysis-core";
import { analyzeDevelopBlobOnMain } from "../src/lib/develop/pixel-analysis";

let passed = 0;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  passed++;
}
const raw = new Uint8ClampedArray([
  0, 70, 90, 255, 255, 20, 40, 255, 0, 0, 0, 255, 10, 20, 30, 255, 80, 90, 100, 255, 255, 255, 255,
  0,
]);
let mode: "ok" | "context" | "draw" | "read" = "ok";
let draws = 0,
  reads = 0;
class Bitmap {
  closed = 0;
  constructor(
    public width = 3,
    public height = 2,
  ) {}
  close() {
    this.closed++;
  }
}
const canvases: Canvas[] = [];
class Canvas {
  width: number;
  height: number;
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
    canvases.push(this);
  }
  getContext() {
    if (mode === "context") return null;
    return {
      drawImage() {
        draws++;
        if (mode === "draw") throw new Error("Synthetic draw failure");
      },
      getImageData(x: number, y: number, width: number, height: number) {
        reads++;
        if (mode === "read") throw new Error("Synthetic read failure");
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++)
          data.set(
            raw.subarray(((y + row) * 3 + x) * 4, ((y + row) * 3 + x + width) * 4),
            row * width * 4,
          );
        return { data, width, height };
      },
    };
  }
}
let bitmap = new Bitmap();
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    createElement(name: string) {
      if (name !== "canvas") throw new Error("Unexpected DOM element");
      return new Canvas();
    },
  },
});
Object.defineProperty(globalThis, "createImageBitmap", {
  configurable: true,
  writable: true,
  value: async () => bitmap,
});
Object.defineProperty(globalThis, "OffscreenCanvas", {
  configurable: true,
  writable: true,
  value: Canvas,
});
const blob = new Blob(["local synthetic decode"], { type: "image/png" });
const clipping = { shadows: true, highlights: true };
const success = await analyzeDevelopBlobOnMain(blob, { clipping });
check(
  JSON.stringify(success.histogram) === JSON.stringify(analyzeDevelopPixels(raw)),
  "Fallback histogram changed pixel math",
);
check(
  String(success.clipping) === String(clippingPixels(raw, true, true, "rgb")),
  "Fallback overlay orientation or shadow semantics changed",
);
check(bitmap.closed === 1, "Fallback did not close decoded bitmap");
check(
  canvases.at(-1)?.width === 0 && canvases.at(-1)?.height === 0,
  "Fallback retained canvas backing pixels",
);
for (const failure of ["context", "draw", "read"] as const) {
  mode = failure;
  bitmap = new Bitmap();
  let error: unknown;
  try {
    await analyzeDevelopBlobOnMain(blob);
  } catch (caught) {
    error = caught;
  }
  check(error instanceof Error, `${failure}: fallback silently succeeded`);
  check(bitmap.closed === 1, `${failure}: fallback leaked a bitmap`);
  check(canvases.at(-1)?.width === 0, `${failure}: fallback leaked a canvas`);
}
mode = "ok";
bitmap = new Bitmap(6001, 6000);
const beforeCanvases = canvases.length;
let boundsError: unknown;
try {
  await analyzeDevelopBlobOnMain(blob);
} catch (caught) {
  boundsError = caught;
}
check(
  boundsError instanceof Error && boundsError.message.includes("36,000,000"),
  "Oversize fallback was not rejected",
);
check(
  bitmap.closed === 1 && canvases.length === beforeCanvases,
  "Oversize fallback allocated a canvas or leaked a bitmap",
);
bitmap = new Bitmap();
let decoded!: (value: ImageBitmap) => void;
let started!: () => void;
const decodeStarted = new Promise<void>((resolve) => {
  started = resolve;
});
globalThis.createImageBitmap = (() => {
  started();
  return new Promise<ImageBitmap>((resolve) => {
    decoded = resolve;
  });
}) as typeof createImageBitmap;
const controller = new AbortController();
const beforeDraws = draws;
const canceled = analyzeDevelopBlobOnMain(blob, { signal: controller.signal }).catch(
  (error: unknown) => error,
);
await decodeStarted;
controller.abort();
decoded(bitmap as unknown as ImageBitmap);
check(((await canceled) as DOMException).name === "AbortError", "Canceled decode returned success");
check(
  bitmap.closed === 1 && draws === beforeDraws,
  "Canceled decode drew stale pixels or leaked bitmap",
);
globalThis.createImageBitmap = (async () => bitmap) as unknown as typeof createImageBitmap;

const replies: { message: PixelAnalysisReply; transfer?: Transferable[] }[] = [];
const scope = {
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
  postMessage(message: PixelAnalysisReply, transfer?: Transferable[]) {
    replies.push({ message, ...(transfer ? { transfer } : {}) });
  },
};
Object.defineProperty(globalThis, "self", { configurable: true, value: scope });
await import("../src/lib/develop/pixel-analysis.worker");
bitmap = new Bitmap();
await scope.onmessage!({ data: { id: 1, blob, clipping } } as MessageEvent);
const reply = replies.at(-1)!;
check("result" in reply.message, "Actual worker did not reply with measured pixels");
if ("result" in reply.message) {
  check(
    JSON.stringify(reply.message.result.histogram) === JSON.stringify(success.histogram),
    "Worker and fallback counts disagree",
  );
  check(
    String(reply.message.result.clipping) === String(success.clipping),
    "Worker and fallback clipping disagree",
  );
  check(
    reply.transfer?.[0] === reply.message.result.clipping?.buffer,
    "Worker did not transfer the overlay buffer",
  );
}
check(
  bitmap.closed === 1 && canvases.at(-1)?.width === 0,
  "Worker success leaked decoded resources",
);
for (const failure of ["context", "draw", "read"] as const) {
  mode = failure;
  bitmap = new Bitmap();
  await scope.onmessage!({ data: { id: 2, blob } } as MessageEvent);
  check("error" in replies.at(-1)!.message, `${failure}: worker did not report an error`);
  check(bitmap.closed === 1 && canvases.at(-1)?.width === 0, `${failure}: worker leaked resources`);
}
mode = "ok";
bitmap = new Bitmap(6001, 6000);
await scope.onmessage!({ data: { id: 3, blob } } as MessageEvent);
check(
  "error" in replies.at(-1)!.message && bitmap.closed === 1,
  "Worker dimension guard leaked a bitmap",
);
bitmap = new Bitmap(8193, 1);
const beforeEdgeCanvases = canvases.length;
await scope.onmessage!({ data: { id: 5, blob } } as MessageEvent);
check(
  "error" in replies.at(-1)!.message &&
    bitmap.closed === 1 &&
    canvases.length === beforeEdgeCanvases,
  "Worker edge guard allocated a canvas or leaked a bitmap",
);
Object.defineProperty(globalThis, "OffscreenCanvas", { value: undefined });
await scope.onmessage!({ data: { id: 4, blob } } as MessageEvent);
const unsupported = replies.at(-1)!.message;
check(
  "error" in unsupported && unsupported.unsupported,
  "Unsupported worker did not request fallback",
);

// Last-resort HTML image decode is still a local blob URL, with listeners and URL released.
Object.defineProperty(globalThis, "createImageBitmap", { value: undefined });
let revoked = "",
  removed = 0;
URL.createObjectURL = () => "blob:pixel-analysis-qa";
URL.revokeObjectURL = (url) => {
  revoked = url;
};
class LocalImage {
  naturalWidth = 3;
  naturalHeight = 2;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    check(value === "blob:pixel-analysis-qa", "Fallback accessed a nonlocal image URL");
    queueMicrotask(() => this.onload?.());
  }
  removeAttribute(name: string) {
    if (name === "src") removed++;
  }
}
Object.defineProperty(globalThis, "Image", { configurable: true, value: LocalImage });
const legacy = await analyzeDevelopBlobOnMain(blob);
check(
  JSON.stringify(legacy.histogram) === JSON.stringify(success.histogram),
  "HTML image fallback changed pixel counts",
);
check(
  revoked === "blob:pixel-analysis-qa" && removed === 1,
  "HTML image fallback retained a source URL",
);
check(reads > 0, "Lifecycle harness did not actually read pixel tiles");
process.stdout.write(JSON.stringify({ passed }));
