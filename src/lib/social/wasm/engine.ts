/** Typed face of celinen-social.wasm (native/wasm/social_wasm.cpp).
 * Environment-free: the page and the test suite drive the same compiled C++.
 */

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_social_error: () => number;
  celinen_social_source: (width: number, height: number) => number;
  celinen_social_frame: (
    format: number,
    fit: number,
    x: number,
    y: number,
    zoom: number,
    white: number,
    quality: number,
  ) => number;
  celinen_social_jpeg: () => number;
  celinen_social_jpeg_size: () => number;
  celinen_social_release: () => void;
};

export type FeedFrame = {
  format: "portrait" | "square";
  /** 0..1: which part of an over-wide or over-tall photo stays in frame. */
  x: number;
  y: number;
  /** 1..3, applied on top of fill. */
  zoom: number;
};

export type SocialWasmEngine = {
  /** A JPEG framed to the feed size. The pixels are consumed. */
  frame(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    frame: FeedFrame,
    quality?: number,
  ): Uint8Array<ArrayBuffer>;
  release(): void;
};

// libc++ links WASI stubs for a console the engine never opens; ENOSYS is truthful.
const WASI_ENOSYS = 52;

export async function instantiateSocialWasm(
  binary: BufferSource | WebAssembly.Module,
): Promise<SocialWasmEngine> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`Social engine needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const wasm = instance.exports as unknown as Exports;
  wasm._initialize?.();
  const failure = () => {
    const bytes = new Uint8Array(wasm.memory.buffer, wasm.celinen_social_error());
    let end = 0;
    while (bytes[end]) end++;
    return new Error(new TextDecoder().decode(bytes.subarray(0, end)) || "Social framing failed.");
  };
  return {
    frame(rgba, width, height, frame, quality = 92) {
      if (rgba.length !== width * height * 4) throw new Error("Invalid photo pixels.");
      const pointer = wasm.celinen_social_source(width, height);
      if (!pointer) throw failure();
      // A view taken after the call: allocation may have grown (and detached) memory.
      new Uint8Array(wasm.memory.buffer, pointer, rgba.length).set(rgba);
      const ok = wasm.celinen_social_frame(
        frame.format === "portrait" ? 0 : 1,
        0,
        frame.x,
        frame.y,
        frame.zoom,
        0,
        quality,
      );
      if (!ok) throw failure();
      const size = wasm.celinen_social_jpeg_size();
      const out = new Uint8Array(size);
      out.set(new Uint8Array(wasm.memory.buffer, wasm.celinen_social_jpeg(), size));
      wasm.celinen_social_release();
      return out;
    },
    release: () => wasm.celinen_social_release(),
  };
}
