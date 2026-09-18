export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "ogv", "ogg"] as const;

export function isVideoFile(file: Pick<File, "name" | "type">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.includes(extension as (typeof VIDEO_EXTENSIONS)[number]);
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function formatTimecode(seconds: number, fps = 30) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const frames = Math.floor((seconds % 1) * fps);
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainder
    .toString()
    .padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
