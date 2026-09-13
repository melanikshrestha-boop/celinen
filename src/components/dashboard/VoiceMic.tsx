import { Mic } from "lucide-react";
import { useVoiceFlow } from "@/lib/voice/useVoiceFlow";
import "./voice-mic.css";

/** Wispr-style dictation: hold to talk, tap to toggle. */
export function VoiceMic({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend?: (text: string) => void;
}) {
  const flow = useVoiceFlow({ value, onChange, onSend });
  return (
    <button
      type="button"
      className={`voice-mic${flow.listening ? " is-listening" : ""}${flow.busy ? " is-busy" : ""}`}
      aria-label={flow.listening ? "Stop dictation" : "Dictate"}
      aria-pressed={flow.listening}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        flow.onPointerDown(event);
      }}
      onPointerUp={() => flow.onPointerUp()}
      onPointerCancel={() => flow.onPointerUp()}
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
