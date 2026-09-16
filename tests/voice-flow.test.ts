import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyVoiceCommands,
  dropLastSentence,
  dropLastUtterance,
  joinUtterance,
  tidySpeech,
} from "../src/lib/voice/clean-transcript";
import { dictationCaretOf, isDictateChord } from "../src/lib/voice/dictation-hotkey";
import { downsampleToPcm16, pcm16ToWav, STT_RATE } from "../src/lib/voice/pcm";

test("spoken commands match Wispr Flow", () => {
  expect(applyVoiceCommands("open pick send that")).toEqual({
    text: "open pick",
    send: true,
    stop: false,
    scratch: false,
    sentence: false,
  });
  expect(applyVoiceCommands("scratch that")).toMatchObject({ scratch: true, text: "" });
  expect(applyVoiceCommands("new line send the gallery")).toEqual({
    text: "send the gallery",
    send: false,
    stop: false,
    scratch: false,
    sentence: false,
  });
  expect(applyVoiceCommands("stop listening")).toMatchObject({ stop: true });
  expect(applyVoiceCommands("hello new paragraph world")).toEqual({
    text: "hello\n\nworld",
    send: false,
    stop: false,
    scratch: false,
    sentence: false,
  });
  expect(applyVoiceCommands("cull this shoot period press enter")).toMatchObject({
    text: "cull this shoot.",
    send: true,
  });
  expect(applyVoiceCommands("delete last sentence")).toMatchObject({ sentence: true, text: "" });
});

test("tidy speech drops fillers and punctuates", () => {
  expect(tidySpeech("um open the gallery uh")).toBe("Open the gallery.");
  expect(tidySpeech("you know cull the keepers i mean")).toBe("Cull the keepers.");
  expect(joinUtterance("Send", "a gallery.")).toBe("Send a gallery.");
  expect(dropLastUtterance("Send a gallery.", "a gallery.")).toBe("Send");
  expect(dropLastSentence("Keep the first. Drop the rest.")).toBe("Keep the first.");
});

test("Control+Space is the in-app dictation chord and inserts at the caret", () => {
  expect(isDictateChord({ code: "Space", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
  expect(isDictateChord({ code: "Space", ctrlKey: true, metaKey: true, altKey: false })).toBe(false);
  expect(
    dictationCaretOf({ value: "hello world", selectionStart: 6, selectionEnd: 6 }, "hello world"),
  ).toEqual({ prefix: "hello ", suffix: "world" });
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
  const cull = readFileSync(new URL("../src/components/studio/CullChat.tsx", import.meta.url), "utf8");
  const mic = readFileSync(new URL("../src/components/dashboard/VoiceMic.tsx", import.meta.url), "utf8");
  const flow = readFileSync(new URL("../src/lib/voice/useVoiceFlow.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/lib/voice/transcribe-client.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/routes/api/voice/stt.ts", import.meta.url), "utf8");
  const stt = readFileSync(new URL("../src/lib/voice/grok-stt.ts", import.meta.url), "utf8");
  expect(home).toContain("VoiceMic");
  expect(home).toContain("inputRef={box}");
  expect(home).not.toContain("webkitSpeechRecognition");
  expect(social).toContain("VoiceMic");
  expect(social).not.toContain("webkitSpeechRecognition");
  expect(cull).toContain("VoiceMic");
  expect(cull).toContain("inputRef={inputRef}");
  expect(mic).toContain("onClick");
  expect(mic).toContain("registerDictationHotkey");
  expect(flow).toContain("openMicStream");
  expect(flow).toContain("MediaRecorder");
  expect(flow).not.toContain("createScriptProcessor");
  expect(client).toContain("/api/voice/stt");
  expect(route).toContain("grokTranscribeAudio");
  expect(stt).toContain("https://api.x.ai/v1/stt");
  expect(stt).toContain("filler_words");
  expect(stt).toContain("XAI_API_KEY");
});
