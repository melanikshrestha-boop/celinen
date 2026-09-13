import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyVoiceCommands,
  dropLastUtterance,
  joinUtterance,
  tidySpeech,
} from "../src/lib/voice/clean-transcript";
import { downsampleToPcm16, pcm16ToWav, STT_RATE } from "../src/lib/voice/pcm";

test("spoken commands match Wispr Flow", () => {
  expect(applyVoiceCommands("open pick send that")).toEqual({
    text: "open pick",
    send: true,
    stop: false,
    scratch: false,
  });
  expect(applyVoiceCommands("scratch that")).toMatchObject({ scratch: true, text: "" });
  expect(applyVoiceCommands("new line send the gallery")).toEqual({
    text: "send the gallery",
    send: false,
    stop: false,
    scratch: false,
  });
  expect(applyVoiceCommands("stop listening")).toMatchObject({ stop: true });
  expect(applyVoiceCommands("hello new paragraph world")).toEqual({
    text: "hello\n\nworld",
    send: false,
    stop: false,
    scratch: false,
  });
});

test("tidy speech drops fillers and punctuates", () => {
  expect(tidySpeech("um open the gallery uh")).toBe("Open the gallery.");
  expect(joinUtterance("Send", "a gallery.")).toBe("Send a gallery.");
  expect(dropLastUtterance("Send a gallery.", "a gallery.")).toBe("Send");
});

test("pcm16 wraps a real WAV header at 16 kHz", () => {
  const pcm = downsampleToPcm16(new Float32Array([0, 0.5, -0.5, 0]), 16_000);
  expect(pcm.length).toBe(4);
  const wav = pcm16ToWav(pcm, STT_RATE);
  expect(wav.type).toBe("audio/wav");
  expect(wav.size).toBe(44 + 8);
});

test("home and social dictation use VoiceMic plus Grok STT", () => {
  const home = readFileSync(new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url), "utf8");
  const social = readFileSync(
    new URL("../src/components/dashboard/SocialAccounts.tsx", import.meta.url),
    "utf8",
  );
  const stt = readFileSync(new URL("../src/lib/voice/grok-stt.ts", import.meta.url), "utf8");
  expect(home).toContain("VoiceMic");
  expect(home).not.toContain("webkitSpeechRecognition");
  expect(social).toContain("VoiceMic");
  expect(social).not.toContain("webkitSpeechRecognition");
  expect(stt).toContain("https://api.x.ai/v1/stt");
  expect(stt).toContain("filler_words");
  expect(stt).toContain("XAI_API_KEY");
});
