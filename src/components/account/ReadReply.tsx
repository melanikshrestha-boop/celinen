import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
export function ReadReply({ text, rate }: { text: string; rate: number }) {
  const [supported, setSupported] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    setSupported("speechSynthesis" in window);
    return () => {
      if (utterance.current) {
        utterance.current.onend = null;
        utterance.current.onerror = null;
        if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      }
    };
  }, []);
  if (!supported) return null;
  return (
    <>
      <button
        className="reply-read-aloud"
        type="button"
        aria-label={playing ? "Stop reading reply" : "Read reply aloud"}
        title={playing ? "Stop reading" : "Read aloud"}
        onClick={() => {
          window.speechSynthesis.cancel();
          if (playing) {
            setPlaying(false);
            return;
          }
          const speech = new SpeechSynthesisUtterance(text.slice(0, 5000));
          utterance.current = speech;
          speech.rate = rate;
          speech.onend = () => {
            setPlaying(false);
            utterance.current = null;
          };
          speech.onerror = (event) => {
            setPlaying(false);
            utterance.current = null;
            if (!["canceled", "interrupted"].includes(event.error))
              setError("Read aloud is unavailable in this browser.");
          };
          setError("");
          setPlaying(true);
          window.speechSynthesis.speak(speech);
        }}
      >
        {playing ? <Square size={14} /> : <Volume2 size={14} />}
      </button>
      {error && <span role="status">{error}</span>}
    </>
  );
}
