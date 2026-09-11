import { useEffect, useRef, useState } from "react";
import { SettingsGroup as Group, SettingsRow as Row } from "./SettingsPrimitives";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";

/** One deliberate frame, in memory only. Every stream is stopped, including late permission grants. */
export function CaptureSettings() {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef("");
  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useToolLeaveGuard(preview ? "This capture has not been saved. Leave and discard it?" : null);
  useEffect(() => {
    const lifecycle = generation;
    setSupported(Boolean(navigator.mediaDevices?.getDisplayMedia));
    return () => {
      lifecycle.current++;
      release();
      URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  const clear = () => {
    URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setPreview("");
  };
  const capture = async () => {
    const ticket = ++generation.current;
    setBusy(true);
    setError("");
    let selected: MediaStream | null = null;
    try {
      selected = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (ticket !== generation.current) return;
      stream.current = selected;
      const video = document.createElement("video");
      video.srcObject = selected;
      video.muted = true;
      await video.play();
      if (ticket !== generation.current) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new Error("The selected view has no image. Try another window.");
      const scale = Math.min(1, 3840 / width, 2160 / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image capture is unavailable in this browser.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      release();
      video.srcObject = null;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("Could not prepare this capture.")),
          "image/png",
        ),
      );
      if (ticket !== generation.current) return;
      clear();
      objectUrl.current = URL.createObjectURL(blob);
      setPreview(objectUrl.current);
    } catch (failure) {
      if (ticket === generation.current)
        setError(
          failure instanceof DOMException && failure.name === "NotAllowedError"
            ? "Capture cancelled or permission denied. Nothing was saved."
            : failure instanceof Error
              ? failure.message
              : "Could not capture this view.",
        );
    } finally {
      selected?.getTracks().forEach((track) => track.stop());
      if (ticket === generation.current) {
        release();
        setBusy(false);
      }
    }
  };
  return (
    <>
      <Group title="Deliberate captures">
        <Row
          title="Capture a view"
          note="Choose a tab, window or screen in your browser’s picker. One frame stays here for review; no audio, continuous recording or automatic upload."
        >
          <button
            className="settings-button"
            disabled={!supported || busy}
            onClick={() => void capture()}
          >
            {busy ? "Waiting for capture…" : "Choose a view"}
          </button>
        </Row>
        <Row
          title="Accessible text"
          note="Browsers do not expose another application’s accessibility tree through screen capture. Only the image is captured."
        >
          Image only
        </Row>
        {!supported && (
          <p className="settings-footnote">
            Screen capture is unavailable here. Use a supported desktop browser over HTTPS or
            loopback.
          </p>
        )}
      </Group>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <section className="settings-capture" aria-label="Capture preview">
          <img src={preview} alt="Your selected view, captured for review" />
          <p>Review for private information before saving or sharing.</p>
          <div className="settings-inline-actions">
            <a className="settings-button" href={preview} download="lenslabs-capture.png">
              Save PNG
            </a>
            <button className="settings-button" onClick={clear}>
              Discard capture
            </button>
          </div>
        </section>
      )}
    </>
  );
}
