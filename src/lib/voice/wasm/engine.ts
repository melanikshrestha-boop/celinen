/** Typed face of celinen-voice.wasm (native/wasm/voice_wasm.cpp): the C++
 * dictation front end. Environment-free so the page and the test suite drive
 * the same compiled binary.
 */
type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_voice_open: (sampleRate: number) => number;
  celinen_voice_input: (count: number) => number;
  celinen_voice_push: (count: number) => number;
  celinen_voice_flush: () => number;
  celinen_voice_level: () => number;
  celinen_voice_speaking: () => number;
  celinen_voice_segment_samples: () => number;
  celinen_voice_segment: () => number;
  celinen_voice_segment_release: () => void;
};

export type VoiceFrontEnd = {
  /** Feed one mono chunk at the microphone's rate. Returns finished utterances
   * as 16 kHz PCM16, oldest first.
   */
  push(samples: Float32Array): Int16Array[];
  /** End of dictation: close and return the utterance still being spoken. */
  flush(): Int16Array[];
  /** Smoothed 0..1 loudness for the meter. */
  level(): number;
  speaking(): boolean;
};

const WASI_ENOSYS = 52;

export async function instantiateVoiceWasm(
  binary: BufferSource | WebAssembly.Module,
  sampleRate: number,
): Promise<VoiceFrontEnd> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`Voice engine needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const wasm = (await WebAssembly.instantiate(module, imports)).exports as unknown as Exports;
  wasm._initialize?.();
  if (wasm.celinen_voice_open(sampleRate) !== 1)
    throw new Error("Unsupported microphone sample rate.");

  const drain = (waiting: number) => {
    if (waiting < 0) throw new Error("The voice engine ran out of memory.");
    const segments: Int16Array[] = [];
    for (let i = 0; i < waiting; i++) {
      const samples = wasm.celinen_voice_segment_samples();
      // Copy out: the segment lives in wasm memory and is freed on release.
      segments.push(
        new Int16Array(new Int16Array(wasm.memory.buffer, wasm.celinen_voice_segment(), samples)),
      );
      wasm.celinen_voice_segment_release();
    }
    return segments;
  };

  return {
    push(samples) {
      if (!samples.length) return [];
      const pointer = wasm.celinen_voice_input(samples.length);
      if (!pointer) throw new Error("The voice engine ran out of memory.");
      // A fresh view every call: growth detaches views of the old buffer.
      new Float32Array(wasm.memory.buffer, pointer, samples.length).set(samples);
      return drain(wasm.celinen_voice_push(samples.length));
    },
    flush: () => drain(wasm.celinen_voice_flush()),
    level: () => wasm.celinen_voice_level(),
    speaking: () => wasm.celinen_voice_speaking() === 1,
  };
}
