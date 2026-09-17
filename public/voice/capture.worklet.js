// Audio-thread tap for dictation. Runs inside AudioWorkletGlobalScope (loaded by src/lib/voice/voice-capture.ts), so it is
// plain JavaScript with no imports. It only forwards microphone samples; all
// signal processing happens in the C++ engine on the page side.
// ~43 ms batches at 48 kHz: small enough for a live meter, large enough that the
// message port is not flooded with 128-sample render quanta.
const BATCH = 2048;

class CelinenCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(BATCH);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true; // no input connected yet; stay alive
    let at = 0;
    while (at < channel.length) {
      const take = Math.min(channel.length - at, BATCH - this.filled);
      this.batch.set(channel.subarray(at, at + take), this.filled);
      this.filled += take;
      at += take;
      if (this.filled === BATCH) {
        this.port.postMessage(this.batch, [this.batch.buffer]);
        this.batch = new Float32Array(BATCH);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("celinen-capture", CelinenCapture);
