import { useEffect, useRef, type RefObject } from "react";
import { Mic } from "lucide-react";
import { useVoiceFlow } from "@/lib/voice/useVoiceFlow";
import {
  dictationCaretOf,
  registerDictationHotkey,
} from "@/lib/voice/dictation-hotkey";
import "./voice-mic.css";

/** Tap to dictate, hold to talk, Control+Space in the composer. */
export function VoiceMic({
  value,
  onChange,
  onSend,
  inputRef,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend?: (text: string) => void;
  inputRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
}) {
  const flow = useVoiceFlow({ value, onChange, ...(onSend ? { onSend } : {}) });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flowRef = useRef(flow);
  const valueRef = useRef(value);
  flowRef.current = flow;
  valueRef.current = value;

  useEffect(() => {
    return registerDictationHotkey({
      armed: () => {
        const button = buttonRef.current;
        const active = document.activeElement;
        if (!button || !active) return false;
        if (active === button) return true;
        if (inputRef?.current && active === inputRef.current) return true;
        const root = button.closest("form, .workbench-composer, .social-post__composer");
        return Boolean(root && root.contains(active));
      },
      listening: () => flowRef.current.listening,
      down: () => {
        const caret = dictationCaretOf(inputRef?.current ?? null, valueRef.current);
        flowRef.current.begin(caret);
      },
      up: () => {
        void flowRef.current.stop();
      },
    });
  }, [inputRef]);

  const caret = () => dictationCaretOf(inputRef?.current ?? null, value);
  const label = flow.error
    ? flow.error
    : flow.busy
      ? "Transcribing"
      : flow.listening
        ? "Stop dictation"
        : "Dictate";

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`voice-mic${flow.listening ? " is-listening" : ""}${flow.busy ? " is-busy" : ""}${flow.error ? " is-error" : ""}`}
      aria-label={label}
      title={label}
      aria-keyshortcuts="Control+Space"
      aria-pressed={flow.listening}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        flow.onPointerDown();
      }}
      onPointerUp={() => flow.onPointerUp()}
      onPointerCancel={() => flow.onPointerUp()}
      onClick={() => flow.onClick(caret())}
    >
      {flow.listening ? (
        <span className="voice-mic__wave" aria-hidden="true">
          {flow.levels.map((level, i) => (
            <span key={i} style={{ height: `${Math.round(level * 100)}%` }} />
          ))}
        </span>
      ) : (
        <Mic size={18} />
      )}
    </button>
  );
}
