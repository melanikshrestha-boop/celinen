import { useEffect, useRef, useState } from "react";
import {
  applyVoiceCommands,
  dropLastSentence,
  dropLastUtterance,
  joinUtterance,
  tidySpeech,
} from "@/lib/voice/clean-transcript";
import type { DictationCaret } from "@/lib/voice/dictation-hotkey";
import { downsampleToPcm16, pcm16ToWav, rmsLevel, STT_RATE } from "@/lib/voice/pcm";
import { transcribeWav } from "@/lib/voice/transcribe-client";

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const BARS = 12;
const HOLD_MS = 180;

export function useVoiceFlow({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend?: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BARS }, () => 0.12));
  const valueRef = useRef(value);
  const listeningRef = useRef(false);
  const prefixRef = useRef("");
  const suffixRef = useRef("");
  const lastFinalRef = useRef("");
  const pcmRef = useRef<Int16Array[]>([]);
  const recRef = useRef<SpeechRec | null>(null);
  const closeMicRef = useRef<(() => void) | null>(null);
  const rafRef = useRef(0);
  const holdAt = useRef(0);
  const held = useRef(false);
  const gen = useRef(0);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      void stop(true);
    },
    [],
  );

  function publish(head: string) {
    onChange(suffixRef.current ? `${head}${suffixRef.current}` : head);
  }

  function paintLive(interim: string) {
    publish(joinUtterance(prefixRef.current, interim));
  }

  async function commitUtterance(live: string) {
    const pcm = pcmRef.current;
    pcmRef.current = [];
    let said = live.trim();
    if (pcm.length) {
      const total = pcm.reduce((n, chunk) => n + chunk.length, 0);
      const merged = new Int16Array(total);
      let offset = 0;
      for (const chunk of pcm) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      if (merged.length > STT_RATE * 0.25) {
        setBusy(true);
        const grok = await transcribeWav(pcm16ToWav(merged));
        setBusy(false);
        if (grok) said = grok;
      }
    }
    if (!said) {
      paintLive("");
      return;
    }
    const cmd = applyVoiceCommands(said);
    if (cmd.scratch || cmd.sentence) {
      const next = cmd.sentence
        ? dropLastSentence(prefixRef.current)
        : dropLastUtterance(prefixRef.current, lastFinalRef.current);
      prefixRef.current = next;
      lastFinalRef.current = "";
      publish(next);
      if (cmd.stop) void stop();
      return;
    }
    const cleaned = cmd.text ? tidySpeech(cmd.text) : "";
    const next = cleaned ? joinUtterance(prefixRef.current, cleaned) : prefixRef.current;
    prefixRef.current = next;
    lastFinalRef.current = cleaned;
    publish(next);
    if (cmd.send) onSend?.(next);
    if (cmd.stop) void stop();
  }

  async function start(caret?: DictationCaret) {
    if (listeningRef.current) return;
    const mine = ++gen.current;
    prefixRef.current = caret?.prefix ?? valueRef.current;
    suffixRef.current = caret?.suffix ?? "";
    lastFinalRef.current = "";
    pcmRef.current = [];
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      return;
    }
    if (gen.current !== mine) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const context = new AudioContext();
    void context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      pcmRef.current.push(downsampleToPcm16(input, context.sampleRate));
    };
    const bins = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(bins);
      const slice = Math.floor(bins.length / BARS);
      const next: number[] = [];
      for (let i = 0; i < BARS; i++) {
        const start = i * slice;
        const view = new Float32Array(slice);
        for (let j = 0; j < slice; j++) view[j] = (bins[start + j]! - 128) / 128;
        next.push(0.12 + rmsLevel(view) * 0.88);
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    closeMicRef.current = () => {
      cancelAnimationFrame(rafRef.current);
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      void context.close();
      for (const track of stream.getTracks()) track.stop();
    };

    const Ctor = speechCtor();
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (event) => {
        let interim = "";
        let finals = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i]![0].transcript;
          if (event.results[i]!.isFinal) finals += `${piece} `;
          else interim += piece;
        }
        if (finals.trim()) void commitUtterance(finals);
        else paintLive(interim);
      };
      rec.onerror = () => {
        /* keep the mic; Grok STT still has the PCM */
      };
      rec.onend = () => {
        if (listeningRef.current) {
          try {
            rec.start();
          } catch {
            /* already running */
          }
        }
      };
      recRef.current = rec;
      rec.start();
    }

    listeningRef.current = true;
    setListening(true);
  }

  async function stop(fromUnmount = false) {
    gen.current += 1;
    if (!listeningRef.current && !fromUnmount) return;
    listeningRef.current = false;
    setListening(false);
    recRef.current?.abort();
    recRef.current = null;
    closeMicRef.current?.();
    closeMicRef.current = null;
    cancelAnimationFrame(rafRef.current);
    const leftover = pcmRef.current;
    pcmRef.current = [];
    if (fromUnmount || leftover.length === 0) return;
    const total = leftover.reduce((n, chunk) => n + chunk.length, 0);
    if (total < STT_RATE * 0.35) return;
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of leftover) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    setBusy(true);
    const grok = await transcribeWav(pcm16ToWav(merged));
    setBusy(false);
    if (!grok) return;
    const cmd = applyVoiceCommands(grok);
    if (cmd.scratch || cmd.sentence) {
      const next = cmd.sentence
        ? dropLastSentence(prefixRef.current)
        : dropLastUtterance(prefixRef.current, lastFinalRef.current);
      prefixRef.current = next;
      publish(next);
      return;
    }
    const cleaned = cmd.text ? tidySpeech(cmd.text) : "";
    if (!cleaned) return;
    const next = joinUtterance(prefixRef.current, cleaned);
    prefixRef.current = next;
    lastFinalRef.current = cleaned;
    publish(next);
    if (cmd.send) onSend?.(next);
  }

  async function toggle() {
    if (listeningRef.current) await stop();
    else await start();
  }

  function onPointerDown(
    event: { button: number; pointerType?: string },
    caret?: DictationCaret,
  ) {
    if (event.button !== 0) return;
    holdAt.current = Date.now();
    held.current = false;
    if (!listeningRef.current) {
      held.current = true;
      void start(caret);
    }
  }

  function begin(caret?: DictationCaret) {
    if (!listeningRef.current) void start(caret);
  }

  function onPointerUp() {
    const heldMs = Date.now() - holdAt.current;
    if (held.current && heldMs >= HOLD_MS) {
      void stop();
      return;
    }
    if (!held.current) void toggle();
  }

  return { listening, busy, levels, toggle, begin, stop, onPointerDown, onPointerUp };
}
