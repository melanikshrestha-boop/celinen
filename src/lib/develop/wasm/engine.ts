/** Typed face of celinen-develop.wasm (native/wasm/develop_wasm.cpp).
 * Environment-free on purpose: the Web Worker and the test suite drive the very
 * same compiled C++ through this one wrapper.
 */
import type { DevelopSettings } from "../contract";
import { developProtocol } from "../protocol";
import {
  isLookDescriptor,
  LOOK_DESCRIPTOR_SIZE,
  LOOK_MAX_INSPIRATIONS,
  LOOK_RESULT_SIZE,
  lookMatchResult,
  type LookDescriptor,
  type LookMatchResult,
} from "../look-match";

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_error: () => number;
  celinen_engine: () => number;
  celinen_alloc: (bytes: number) => number;
  celinen_release: (pointer: number) => void;
  celinen_source: (width: number, height: number) => number;
  celinen_develop: (protocol: number, length: number, highResolution: number) => number;
  celinen_result_width: () => number;
  celinen_result_height: () => number;
  celinen_result_pixels: () => number;
  celinen_result_release: () => void;
  celinen_suggest: () => number;
  celinen_look_size: () => number;
  celinen_look_describe: () => number;
  celinen_look_inputs: (count: number) => number;
  celinen_look_match: (
    count: number,
    protocol: number,
    length: number,
    outputEdge: number,
  ) => number;
};

export type DevelopWasmImage = {
  width: number;
  height: number;
  /** An owned copy outside wasm memory, ready for ImageData. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
};

/** Measured starting point in recipe slider units (native DevelopAuto). */
export type DevelopAutoSuggestion = {
  applicable: boolean;
  whiteBalanceMeasured: boolean;
  patch: Pick<
    DevelopSettings,
    | "exposure"
    | "contrast"
    | "highlights"
    | "shadows"
    | "whites"
    | "blacks"
    | "temperature"
    | "tint"
    | "vibrance"
  >;
};

export type DevelopWasmEngine = {
  readonly version: string;
  /** Size the retained source and return a view to fill with RGBA pixels. The
   * view dies at the next engine call: wasm memory may grow and detach it.
   */
  source(width: number, height: number): Uint8ClampedArray;
  develop(settings: DevelopSettings, highResolution?: boolean): DevelopWasmImage;
  suggest(): DevelopAutoSuggestion;
  /** Measure the loaded source as an inspiration. */
  describeLook(): LookDescriptor;
  /** Solve a recipe that gives the loaded source the combined look of `looks`,
   * keeping everything a look never touches from `settings`.
   */
  matchLook(
    looks: readonly LookDescriptor[],
    settings: DevelopSettings,
    outputEdge: number,
  ): LookMatchResult;
};

// The engine is pure computation. Its only imports are the WASI stubs libc++
// iostream links for a console it never opens; answering ENOSYS is truthful.
const WASI_ENOSYS = 52;

export async function instantiateDevelopWasm(
  binary: BufferSource | WebAssembly.Module,
): Promise<DevelopWasmEngine> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`Develop engine needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const wasm = instance.exports as unknown as Exports;
  wasm._initialize?.();

  const text = (pointer: number) => {
    const bytes = new Uint8Array(wasm.memory.buffer, pointer);
    let end = 0;
    while (bytes[end]) end++;
    return new TextDecoder().decode(bytes.subarray(0, end));
  };
  const failure = () => new Error(text(wasm.celinen_error()) || "Develop failed.");

  return {
    version: text(wasm.celinen_engine()),
    source(width, height) {
      const pointer = wasm.celinen_source(width, height);
      if (!pointer) throw failure();
      return new Uint8ClampedArray(wasm.memory.buffer, pointer, width * height * 4);
    },
    develop(settings, highResolution = false) {
      const protocol = new TextEncoder().encode(developProtocol(settings));
      const pointer = wasm.celinen_alloc(protocol.length);
      if (!pointer)
        throw new Error("This photo is too large for the browser's memory at this size.");
      try {
        new Uint8Array(wasm.memory.buffer, pointer, protocol.length).set(protocol);
        if (!wasm.celinen_develop(pointer, protocol.length, highResolution ? 1 : 0))
          throw failure();
      } finally {
        wasm.celinen_release(pointer);
      }
      const width = wasm.celinen_result_width(),
        height = wasm.celinen_result_height();
      // Copy out before releasing: the result lives in wasm memory, which the
      // next render reuses and growth can detach.
      const rgba = new Uint8ClampedArray(width * height * 4);
      rgba.set(
        new Uint8ClampedArray(wasm.memory.buffer, wasm.celinen_result_pixels(), rgba.length),
      );
      wasm.celinen_result_release();
      return { width, height, rgba };
    },
    suggest() {
      const pointer = wasm.celinen_suggest();
      if (!pointer) throw failure();
      // `+ 0` folds the engine's negative zero into a plain 0 for recipe equality.
      const v = Array.from(new Float64Array(wasm.memory.buffer, pointer, 11), (value) => value + 0);
      return {
        applicable: v[10] === 1,
        whiteBalanceMeasured: v[9] === 1,
        patch: {
          exposure: v[0]!,
          contrast: v[1]!,
          highlights: v[2]!,
          shadows: v[3]!,
          whites: v[4]!,
          blacks: v[5]!,
          temperature: v[6]!,
          tint: v[7]!,
          vibrance: v[8]!,
        },
      };
    },
    describeLook() {
      if (wasm.celinen_look_size() !== LOOK_DESCRIPTOR_SIZE)
        throw new Error(
          "The Develop engine and page disagree on the look format. Reload the page.",
        );
      const pointer = wasm.celinen_look_describe();
      if (!pointer) throw failure();
      // Copied out: the next describe reuses this memory.
      return new Float64Array(new Float64Array(wasm.memory.buffer, pointer, LOOK_DESCRIPTOR_SIZE));
    },
    matchLook(looks, settings, outputEdge) {
      if (!looks.length || looks.length > LOOK_MAX_INSPIRATIONS || !looks.every(isLookDescriptor))
        throw new Error("Drop an inspiration photo first.");
      const inputs = wasm.celinen_look_inputs(looks.length);
      if (!inputs) throw failure();
      const room = new Float64Array(
        wasm.memory.buffer,
        inputs,
        looks.length * LOOK_DESCRIPTOR_SIZE,
      );
      looks.forEach((look, index) => room.set(look, index * LOOK_DESCRIPTOR_SIZE));
      const protocol = new TextEncoder().encode(developProtocol(settings));
      const pointer = wasm.celinen_alloc(protocol.length);
      if (!pointer)
        throw new Error("This photo is too large for the browser's memory at this size.");
      let result: number;
      try {
        new Uint8Array(wasm.memory.buffer, pointer, protocol.length).set(protocol);
        result = wasm.celinen_look_match(
          looks.length,
          pointer,
          protocol.length,
          Math.max(1, Math.round(outputEdge)),
        );
      } finally {
        wasm.celinen_release(pointer);
      }
      if (!result) throw failure();
      return lookMatchResult(
        settings,
        new Float64Array(wasm.memory.buffer, result, LOOK_RESULT_SIZE),
      );
    },
  };
}
