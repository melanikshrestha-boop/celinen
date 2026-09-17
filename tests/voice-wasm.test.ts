import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateVoiceWasm } from "../src/lib/voice/wasm/engine";

// Runs the committed binary: the exact bytes lenslab.dev serves.
const binary = readFileSync(new URL("../src/lib/voice/wasm/celinen-voice.wasm", import.meta.url));

function speech(rate: number, seconds: number, amplitude: number) {
  const out = new Float32Array(Math.floor(rate * seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    out[i] =
      (amplitude *
        (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) *
        (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t))) /
      1.5;
  }
  return out;
}
const silence = (rate: number, seconds: number) => new Float32Array(Math.floor(rate * seconds));

function feed(push: (chunk: Float32Array) => Int16Array[], audio: Float32Array, chunk = 2048) {
  const segments: Int16Array[] = [];
  for (let at = 0; at < audio.length; at += chunk)
    segments.push(...push(audio.subarray(at, Math.min(audio.length, at + chunk))));
  return segments;
}

test("C++ voice front end segments an utterance into 16 kHz PCM16", async () => {
  const voice = await instantiateVoiceWasm(binary, 48_000);
  const segments = [
    ...feed(voice.push, silence(48_000, 0.6)),
    ...feed(voice.push, speech(48_000, 1.2, 0.2)),
  ];
  expect(segments).toEqual([]);
  expect(voice.speaking()).toBe(true);
  expect(voice.level()).toBeGreaterThan(0.1);
  segments.push(...feed(voice.push, silence(48_000, 1.2)));
  expect(segments.length).toBe(1);
  expect(voice.speaking()).toBe(false);
  const seconds = segments[0]!.length / 16_000;
  expect(seconds).toBeGreaterThan(1.5);
  expect(seconds).toBeLessThan(1.9);
  expect(Math.max(...segments[0]!.map((v) => Math.abs(v)))).toBeGreaterThan(20_000);
});

test("flush returns the utterance still being spoken; key taps and empty chunks yield nothing", async () => {
  const voice = await instantiateVoiceWasm(binary, 44_100);
  expect(voice.push(new Float32Array(0))).toEqual([]);
  const tap = new Float32Array(1323).map(
    (_, i) => 0.6 * Math.sin((2 * Math.PI * 3000 * i) / 44_100),
  );
  feed(voice.push, silence(44_100, 0.5));
  feed(voice.push, tap);
  feed(voice.push, silence(44_100, 1));
  expect(voice.flush()).toEqual([]);
  feed(voice.push, speech(44_100, 1, 0.2));
  const flushed = voice.flush();
  expect(flushed.length).toBe(1);
  expect(voice.flush()).toEqual([]);
});

test("an unusable sample rate is rejected", async () => {
  await expect(instantiateVoiceWasm(binary, 4000)).rejects.toThrow("sample rate");
});
