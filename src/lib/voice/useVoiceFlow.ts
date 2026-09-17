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
import { pcm16ToWav, rmsLevel } from "@/lib/voice/pcm";
import { polishDictation } from "@/lib/voice/polish-client";
import { transcribeBlob } from "@/lib/voice/transcribe-client";
import { openVoiceCapture, type VoiceCapture } from "@/lib/voice/voice-capture";

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
// The browser recognizer finalizes a phrase a beat after the C++ engine closes
// the same utterance; finals inside this window belong to that utterance.
const PREVIEW_LAG_MS = 400;

/** Dictation into a controlled text field.
 *
 * Three layers, each optional below the first:
 *  1. The C++ engine cuts the microphone into utterances; each is transcribed by
 *     Grok while the next is still being spoken, so text settles thought by thought.
 *  2. The browser recognizer paints a live preview. It is never committed unless
 *     transcription fails, so words are not doubled.
 *  3. When dictation ends, a long take is reorganized into clean paragraphs and lists.
 * Without the engine, the recorder's whole take is transcribed once at the end.
 */
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
  const finalizingRef = useRef(false);
  const pendingStopRef = useRef(false);
  // Text before this dictation began; everything after it in `prefixRef` was spoken now.
  const baseRef = useRef("");
  const prefixRef = useRef("");
  const suffixRef = useRef("");
  const publishedRef = useRef<string | null>(null);
  const lastFinalRef = useRef("");
  const liveRef = useRef("");
  const previewFinalsRef = useRef<{ text: string; at: number }[]>([]);
  const recRef = useRef<SpeechRec | null>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const closeMicRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const utterancesRef = useRef(0);
  const rafRef = useRef(0);
  const held = useRef(false);
  const skipClick = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);
  // Outlives `gen`: transcripts still in flight after Stop belong to their session.
  const session = useRef(0);

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
    const next = suffixRef.current ? `${head}${suffixRef.current}` : head;
    publishedRef.current = next;
    onChange(next);
  }

  function paintPreview() {
    const spoken = [...previewFinalsRef.current.map((final) => final.text), liveRef.current]
      .join(" ")
      .trim();
    publish(joinUtterance(prefixRef.current, spoken));
  }

  /** Remove and return the preview finals that an utterance closed at `closedAt` covers. */
  function takePreview(closedAt: number) {
    const covered = previewFinalsRef.current.filter(
      (final) => final.at <= closedAt + PREVIEW_LAG_MS,
    );
    previewFinalsRef.current = previewFinalsRef.current.filter((final) => !covered.includes(final));
    return covered
      .map((final) => final.text)
      .join(" ")
      .trim();
  }

  function applySaid(said: string) {
    const cmd = applyVoiceCommands(said);
    if (cmd.scratch || cmd.sentence) {
      const next = cmd.sentence
        ? dropLastSentence(prefixRef.current)
        : dropLastUtterance(prefixRef.current, lastFinalRef.current);
      prefixRef.current = next;
      // Scratching past the start of this take edits older text; none of it is "spoken now".
      if (!next.startsWith(baseRef.current)) baseRef.current = next;
      lastFinalRef.current = "";
    } else {
      const cleaned = cmd.text ? tidySpeech(cmd.text) : "";
      if (cleaned) {
        prefixRef.current = joinUtterance(prefixRef.current, cleaned);
        lastFinalRef.current = cleaned;
      }
    }
    paintPreview();
    if (cmd.send) onSend?.(prefixRef.current);
    if (cmd.stop && listeningRef.current) void stop();
  }

  /** Transcribe one utterance in arrival order; the preview stands in if Grok cannot. */
  function enqueueUtterance(audio: Blob, closedAt: number, mine: number) {
    chainRef.current = chainRef.current.then(async () => {
      if (session.current !== mine) return;
      const text = await transcribeBlob(audio);
      if (session.current !== mine) return;
      const preview = takePreview(closedAt);
      const said = text ?? preview;
      if (said) applySaid(said);
      else paintPreview();
    });
  }

  async function start(caret?: DictationCaret) {
    if (listeningRef.current || startingRef.current || finalizingRef.current) return;
    startingRef.current = true;
    pendingStopRef.current = false;
    const mine = ++gen.current;
    const take = ++session.current;
    prefixRef.current = baseRef.current = caret?.prefix ?? valueRef.current;
    suffixRef.current = caret?.suffix ?? "";
    lastFinalRef.current = "";
    liveRef.current = "";
    previewFinalsRef.current = [];
    chainRef.current = Promise.resolve();
    utterancesRef.current = 0;
    // A triple-tap typed spaces before it was recognized; the caret predates them.
    if (caret && `${caret.prefix}${caret.suffix}` !== valueRef.current) publish(caret.prefix);
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
      const source = context?.createMediaStreamSource(stream) ?? null;
      const analyser = context?.createAnalyser() ?? null;
      if (source && analyser) {
        analyser.fftSize = 512;
        source.connect(analyser);
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

      // The recorder starts first and keeps the whole take: nothing said while
      // the engine loads is lost, and it is the fallback if the engine fails.
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
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const piece = event.results[i]![0].transcript.trim();
            if (!event.results[i]!.isFinal) interim += `${piece} `;
            else if (piece) previewFinalsRef.current.push({ text: piece, at: performance.now() });
          }
          liveRef.current = interim.trim();
          paintPreview();
        };
        rec.onerror = () => {
          /* Preview only; the engine and recorder still have the take. */
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

      if (context && source) {
        const capture = await openVoiceCapture(context, source, (pcm) => {
          utterancesRef.current += 1;
          enqueueUtterance(pcm16ToWav(pcm), performance.now(), take);
        });
        // Unmounted while the engine loaded: stop(true) already closed the mic.
        if (gen.current !== mine && !pendingStopRef.current) {
          capture?.close();
          return;
        }
        captureRef.current = capture;
      }

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
    if (fromUnmount) session.current += 1;
    if (startingRef.current && !fromUnmount) {
      pendingStopRef.current = true;
      return;
    }
    if (!listeningRef.current && !fromUnmount) return;
    listeningRef.current = false;
    setListening(false);
    const mine = session.current;
    const capture = captureRef.current;
    captureRef.current = null;
    // Closing flushes the utterance in progress into the transcription chain.
    capture?.close();
    const close = closeMicRef.current;
    closeMicRef.current = null;
    cancelAnimationFrame(rafRef.current);
    recRef.current?.abort();
    recRef.current = null;
    const take = close ? await close() : null;
    if (fromUnmount) return;

    finalizingRef.current = true;
    setBusy(true);
    try {
      await chainRef.current;
      if (session.current !== mine) return;
      if (capture?.healthy() && utterancesRef.current) {
        // Speech the engine judged too quiet to cut may still have been heard.
        const unheard = takePreview(Infinity);
        if (unheard) applySaid(unheard);
      } else {
        // No engine, it failed part-way, or it heard nothing (a whisper, a far
        // microphone): the recorder's whole take is the truth.
        if (capture) prefixRef.current = baseRef.current;
        const grok = take && take.size >= 80 ? await transcribeBlob(take) : null;
        if (session.current !== mine) return;
        const preview = [takePreview(Infinity), liveRef.current].join(" ").trim();
        const said = grok ?? preview;
        if (said) applySaid(said);
      }
      liveRef.current = "";
      previewFinalsRef.current = [];
      paintPreview();

      const base = baseRef.current;
      const spoken = prefixRef.current.startsWith(base) ? prefixRef.current.slice(base.length) : "";
      const polished = spoken.trim() ? await polishDictation(spoken.trim()) : null;
      // Replace only what we last wrote: if the field was sent, cleared or typed
      // into while the rewrite was in flight, the photographer's version wins.
      if (polished && session.current === mine && valueRef.current === publishedRef.current) {
        prefixRef.current = joinUtterance(base, polished);
        publish(prefixRef.current);
      }
    } finally {
      finalizingRef.current = false;
      if (session.current === mine) setBusy(false);
    }
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
