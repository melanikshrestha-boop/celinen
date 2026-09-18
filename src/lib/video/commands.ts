import type { VideoFilter } from "./session";

export type VideoCommand =
  | { kind: "export" }
  | { kind: "undo" }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "razor" }
  | { kind: "ripple-delete" }
  | { kind: "insert-selected" }
  | { kind: "filter"; filter: VideoFilter }
  | { kind: "verdict"; verdict: "keep" | "reject"; ids: "selected" | "all" }
  | { kind: "verdict-duration"; verdict: "keep" | "reject"; compare: "over" | "under"; seconds: number }
  | { kind: "verdict-first"; count: number }
  | { kind: "unknown" };

export function parseVideoCommand(raw: string): VideoCommand {
  const value = raw.trim().toLowerCase();
  if (!value) return { kind: "unknown" };

  if (/\b(export|download|manifest)\b/.test(value)) return { kind: "export" };
  if (/\bundo\b/.test(value)) return { kind: "undo" };
  if (/^\s*pause\b/.test(value) || /\bpause\s+(?:playback|sequence|timeline)\b/.test(value))
    return { kind: "pause" };
  if (/^\s*play\b/.test(value) || /\bplay\s+(?:the\s+)?(?:sequence|timeline)\b/.test(value))
    return { kind: "play" };
  if (/\b(razor|split|blade)\b/.test(value)) return { kind: "razor" };
  if (/\b(ripple\s*delete|delete\s+clip|remove\s+clip)\b/.test(value))
    return { kind: "ripple-delete" };
  if (/\b(insert|add|put|drop)\b.*\b(timeline|sequence|v1|v2)\b/.test(value))
    return { kind: "insert-selected" };

  if (/\b(show|filter)\b.*\b(keeper|keepers|selects)\b/.test(value))
    return { kind: "filter", filter: "keepers" };
  if (/\b(show|filter)\b.*\b(reject|rejected|cuts)\b/.test(value))
    return { kind: "filter", filter: "rejected" };
  if (/\b(show|filter)\b.*\b(todo|undecided|unreviewed)\b/.test(value))
    return { kind: "filter", filter: "todo" };
  if (/\b(show|filter)\b.*\ball\b/.test(value)) return { kind: "filter", filter: "all" };

  if (/\bkeep\b.*\b(selected|this|current)\b/.test(value))
    return { kind: "verdict", verdict: "keep", ids: "selected" };
  if (/\b(reject|cut)\b.*\b(selected|this|current)\b/.test(value))
    return { kind: "verdict", verdict: "reject", ids: "selected" };

  const longer = value.match(
    /\bkeep\b.*\b(?:longer than|over|more than)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\b/,
  );
  if (longer) {
    return {
      kind: "verdict-duration",
      verdict: "keep",
      compare: "over",
      seconds: Number(longer[1]),
    };
  }
  const shorter = value.match(
    /\b(?:reject|cut)\b.*\b(?:shorter|under|less than)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\b/,
  );
  if (shorter) {
    return {
      kind: "verdict-duration",
      verdict: "reject",
      compare: "under",
      seconds: Number(shorter[1]),
    };
  }
  const first = value.match(/\bkeep\b.*\bfirst\s+(\d+)\b/);
  if (first) return { kind: "verdict-first", count: Math.max(0, Number(first[1])) };
  if (/\bkeep\b.*\ball\b/.test(value)) return { kind: "verdict", verdict: "keep", ids: "all" };
  if (/\b(reject|cut)\b.*\ball\b/.test(value))
    return { kind: "verdict", verdict: "reject", ids: "all" };

  return { kind: "unknown" };
}
