/** Browser mic open + recorder type. Keep constraints loose — Safari rejects fancy graphs. */

export async function openMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("Microphone is not available in this browser."), {
      name: "NotSupportedError",
    });
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (first) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw first;
    }
  }
}

export function micErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Allow the microphone";
  if (name === "NotFoundError") return "No microphone";
  if (name === "NotReadableError") return "Microphone busy";
  if (name === "NotSupportedError") return "Microphone is not available";
  return "Microphone failed";
}

export function recorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
