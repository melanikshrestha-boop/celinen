import { useEffect, useRef, useState } from "react";
import {
  applyVoiceCommands,
  dropLastSentence,
  dropLastUtterance,
  joinUtterance,
  tidySpeech,
} from "@/lib/voice/clean-transcript";
import type { DictationCaret } from "@/lib/voice/dictation-hotkey";
import { micErrorMessage, openMicStream, recorderMime } from "@/lib/voice/mic-capture";
import { rmsLevel } from "@/lib/voice/pcm";
import { transcribeBlob } from "@/lib/voice/transcribe-client";

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
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BARS }, () => 0.12));
  const valueRef = useRef(value);
  const listeningRef = useRef(false);
  const startingRef = useRef(false);
  const pendingStopRef = useRef(false);
  const prefixRef = useRef("");
  const suffixRef = useRef("");
  const lastFinalRef = useRef("");
  const liveRef = useRef("");
  const recRef = useRef<SpeechRec | null>(null);
  const closeMicRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const rafRef = useRef(0);
  const held = useRef(false);
  const skipClick = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    liveRef.current = interim;
    publish(joinUtterance(prefixRef.current, interim));
  }

  function applySaid(said: string) {
    const cmd = applyVoiceCommands(said);
    if (cmd.scratch || cmd.sentence) {
      const next = cmd.sentence
        ? dropLastSentence(prefixRef.current)
        : dropLastUtterance(prefixRef.current, lastFinalRef.current);
      prefixRef.current = next;
      lastFinalRef.current = "";
      liveRef.current = "";
      publish(next);
      return;
    }
    const cleaned = cmd.text ? tidySpeech(cmd.text) : "";
    if (!cleaned) return;
    const next = joinUtterance(prefixRef.current, cleaned);
    prefixRef.current = next;
    lastFinalRef.current = cleaned;
    liveRef.current = "";
    publish(next);
    if (cmd.send) onSend?.(next);
  }

  async function start(caret?: DictationCaret) {
    if (listeningRef.current || startingRef.current) return;
    startingRef.current = true;
    pendingStopRef.current = false;
    const mine = ++gen.current;
    prefixRef.current = caret?.prefix ?? valueRef.current;
    suffixRef.current = caret?.suffix ?? "";
    lastFinalRef.current = "";
    liveRef.current = "";
    setError(null);
    listeningRef.current = true;
    setListening(true);
    let stream: MediaStream | null = null;
    try {
      stream = await openMicStream();
      if (gen.current !== mine) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const context = AudioCtx ? new AudioCtx() : null;
      if (context) void context.resume();
      const analyser = context?.createAnalyser() ?? null;
      if (context && analyser) {
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const bins = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(bins);
          const slice = Math.max(1, Math.floor(bins.length / BARS));
          const next: number[] = [];
          for (let i = 0; i < BARS; i++) {
            const view = new Float32Array(slice);
            for (let j = 0; j < slice; j++) view[j] = (bins[i * slice + j]! - 128) / 128;
            next.push(0.12 + rmsLevel(view) * 0.88);
          }
          setLevels(next);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }

      const chunks: Blob[] = [];
      const mime = recorderMime();
      const recorder =
        typeof MediaRecorder !== "undefined"
          ? mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream)
          : null;
      if (recorder) {
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.start(200);
      }

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
          if (finals.trim()) {
            applySaid(finals);
            liveRef.current = "";
          } else paintLive(interim);
        };
        rec.onerror = () => {
          /* MediaRecorder + Grok STT still have the take. */
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
        try {
          rec.start();
        } catch {
          recRef.current = null;
        }
      }

      closeMicRef.current = () =>
        new Promise((resolve) => {
          cancelAnimationFrame(rafRef.current);
          recRef.current?.abort();
          recRef.current = null;
          const finish = () => {
            void context?.close();
            for (const track of stream!.getTracks()) track.stop();
            const type = recorder?.mimeType || mime || "audio/webm";
            resolve(chunks.length ? new Blob(chunks, { type }) : null);
          };
          if (recorder && recorder.state !== "inactive") {
            recorder.onstop = finish;
            try {
              recorder.stop();
            } catch {
              finish();
            }
          } else finish();
        });

      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        startingRef.current = false;
        await stop();
        return;
      }
    } catch (cause) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      listeningRef.current = false;
      setListening(false);
      setError(micErrorMessage(cause));
    } finally {
      startingRef.current = false;
    }
  }

  async function stop(fromUnmount = false) {
    gen.current += 1;
    if (startingRef.current && !fromUnmount) {
      pendingStopRef.current = true;
      return;
    }
    if (!listeningRef.current && !fromUnmount) return;
    listeningRef.current = false;
    setListening(false);
    const close = closeMicRef.current;
    closeMicRef.current = null;
    cancelAnimationFrame(rafRef.current);
    recRef.current?.abort();
    recRef.current = null;
    const blob = close ? await close() : null;
    if (fromUnmount) return;
    const live = liveRef.current.trim();
    liveRef.current = "";
    if (blob && blob.size >= 80) {
      setBusy(true);
      const grok = await transcribeBlob(blob);
      setBusy(false);
      if (grok) {
        applySaid(grok);
        return;
      }
    }
    if (live) applySaid(live);
  }

  async function toggle(caret?: DictationCaret) {
    if (listeningRef.current || startingRef.current) await stop();
    else await start(caret);
  }

  function onPointerDown() {
    held.current = false;
    skipClick.current = false;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      if (!listeningRef.current) void start();
    }, HOLD_MS);
  }

  function onPointerUp() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (held.current) {
      skipClick.current = true;
      held.current = false;
      void stop();
    }
  }

  function onClick(caret?: DictationCaret) {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    void toggle(caret);
  }

  return {
    listening,
    busy,
    error,
    levels,
    toggle,
    begin: start,
    stop,
    onPointerDown,
    onPointerUp,
    onClick,
  };
}
