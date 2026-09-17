/** Microphone → C++ front end. The audio thread forwards raw samples; the C++
 * engine (WebAssembly) removes DC, resamples to 16 kHz, detects speech and cuts
 * utterances at natural pauses, so each thought can be transcribed while the
 * next one is still being spoken.
 */
import { instantiateVoiceWasm } from "./wasm/engine";

// Resolved lazily, in the browser only: the bundler rewrites this to a hashed
// asset URL, and nothing here may run while the server renders the page.
const wasmUrl = () => new URL("./wasm/celinen-voice.wasm", import.meta.url).href;
// Served from public/ as a real same-origin file. Bundled, a script this small is
// inlined as a data: URL, which the site's script-src rightly refuses to load.
// Bump the version when public/voice/capture.worklet.js changes.
const WORKLET_URL = "/voice/capture.worklet.js?v=1";

export type VoiceCapture = {
  /** Stop listening. The utterance in progress is delivered before this returns. */
  close(): void;
  /** False once the engine has failed; the caller falls back to its full recording. */
  healthy(): boolean;
};

/** Fetch and compile the engine ahead of the first dictation so it starts instantly. */
export function warmVoiceCapture() {
  if (typeof WebAssembly !== "undefined" && typeof AudioWorkletNode !== "undefined")
    void voiceModule().catch(() => {});
}

let compiled: Promise<WebAssembly.Module> | null = null;
function voiceModule() {
  compiled ??= fetch(wasmUrl())
    .then((response) => {
      if (!response.ok) throw new Error(`Voice engine download failed (${response.status}).`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.compile(bytes));
  // A failed download must not poison every later dictation on this page.
  compiled.catch(() => (compiled = null));
  return compiled;
}

/** Null when this browser cannot run the engine (no AudioWorklet, blocked
 * WebAssembly, failed download); the caller keeps its recorder fallback.
 */
export async function openVoiceCapture(
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  onUtterance: (pcm16k: Int16Array) => void,
): Promise<VoiceCapture | null> {
  if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
  if (typeof WebAssembly === "undefined") return null;
  try {
    const [engine] = await Promise.all([
      voiceModule().then((module) => instantiateVoiceWasm(module, context.sampleRate)),
      context.audioWorklet.addModule(WORKLET_URL),
    ]);
    const node = new AudioWorkletNode(context, "celinen-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    // Browsers only pull nodes that reach the destination; a muted gain keeps the
    // tap alive without ever playing the microphone back.
    const mute = context.createGain();
    mute.gain.value = 0;
    let open = true;
    let failed = false;
    const deliver = (utterances: Int16Array[]) => {
      for (const pcm of utterances) onUtterance(pcm);
    };
    node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (!open || failed) return;
      try {
        deliver(engine.push(data));
      } catch {
        // Out of memory inside the engine: stop feeding it. The caller's
        // recorder still holds the whole take.
        failed = true;
      }
    };
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    return {
      close() {
        if (!open) return;
        open = false;
        node.port.onmessage = null;
        try {
          source.disconnect(node);
          node.disconnect();
          mute.disconnect();
        } catch {
          /* the context was already closed under us */
        }
        if (failed) return;
        try {
          deliver(engine.flush());
        } catch {
          failed = true;
        }
      },
      healthy: () => !failed,
    };
  } catch {
    return null;
  }
}
