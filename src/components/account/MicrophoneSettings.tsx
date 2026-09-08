import { useCallback, useEffect, useRef, useState } from "react";
import {
  SettingsChoice as Choice,
  SettingsGroup as Group,
  SettingsRow as Row,
} from "./SettingsPrimitives";

/** Audio level only: never records, uploads, recognizes speech, or connects to an output. */
export function MicrophoneSettings() {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "asking" | "active">("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("default");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const resources = useRef<{ stream: MediaStream; audio: AudioContext; timer: number } | null>(
    null,
  );
  const cleanup = useCallback(() => {
    generation.current++;
    const current = resources.current;
    if (!current) return;
    window.clearInterval(current.timer);
    current.stream.getTracks().forEach((track) => track.stop());
    void current.audio.close().catch(() => undefined);
    resources.current = null;
  }, []);
  const stop = useCallback(() => {
    cleanup();
    setState("idle");
    setLevel(0);
  }, [cleanup]);
  useEffect(() => {
    setSupported(
      typeof navigator.mediaDevices?.getUserMedia === "function" && "AudioContext" in window,
    );
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      cleanup();
    };
  }, [cleanup, stop]);
  const start = async () => {
    cleanup();
    const ticket = generation.current;
    setState("asking");
    setError("");
    let stream: MediaStream | null = null;
    let audio: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: device === "default" ? true : { deviceId: { exact: device } },
        video: false,
      });
      if (ticket !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length,
        );
        setLevel(Math.min(100, Math.round(rms * 300)));
      }, 100);
      resources.current = { stream, audio, timer };
      stream
        .getAudioTracks()
        .forEach((track) => track.addEventListener("ended", stop, { once: true }));
      setState("active");
      const inputs = await navigator.mediaDevices.enumerateDevices();
      if (ticket === generation.current)
        setDevices(
          inputs.filter(
            (input) =>
              input.kind === "audioinput" && input.deviceId && input.deviceId !== "default",
          ),
        );
    } catch (failure) {
      stream?.getTracks().forEach((track) => track.stop());
      if (audio && audio.state !== "closed") void audio.close().catch(() => undefined);
      if (ticket !== generation.current) return;
      cleanup();
      setState("idle");
      setError(
        failure instanceof DOMException && failure.name === "NotAllowedError"
          ? "Microphone permission was denied. No audio was recorded."
          : "Microphone unavailable. Connect an input and check browser permissions.",
      );
    }
  };
  return (
    <Group title="Microphone">
      <Row
        title="Microphone test"
        note="Allow access only when you choose Test. This reads an input level, not a recording. It stops when you leave this page or hide the tab."
      >
        <button
          className="settings-button"
          disabled={!supported}
          onClick={state === "idle" ? () => void start() : stop}
        >
          {state === "idle"
            ? "Test microphone"
            : state === "asking"
              ? "Cancel request"
              : "Stop microphone"}
        </button>
      </Row>
      <Row
        title="Input device"
        note="Device names become available after permission. Selection lasts for this test page only."
      >
        <Choice
          label="Input device"
          value={device}
          options={[
            ["default", "System default"],
            ...devices.map(
              (input, index) => [input.deviceId, input.label || `Microphone ${index + 1}`] as const,
            ),
          ]}
          change={(value) => {
            stop();
            setDevice(value);
          }}
        />
      </Row>
      {state === "active" && (
        <div className="settings-microphone-level">
          <span role="status">Microphone active · not recording</span>
          <meter aria-label="Microphone input level" min={0} max={100} value={level} />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!supported && (
        <p className="settings-footnote">
          Microphone testing requires a supported browser over HTTPS or loopback.
        </p>
      )}
    </Group>
  );
}
