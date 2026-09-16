/** Wispr-style spoken commands + a light cleanup when Grok STT is not in the path. */

export type VoiceCommand = {
  text: string;
  send: boolean;
  stop: boolean;
  scratch: boolean;
  sentence: boolean;
};

const FILLERS = /\b(?:um+|uh+|er+|ah+|hmm+|you know|i mean)\b[,.]?/gi;

export function tidySpeech(raw: string): string {
  let text = raw.replace(FILLERS, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.?!]$/.test(text)) text += ".";
  return text;
}

export function applyVoiceCommands(raw: string): VoiceCommand {
  let text = raw.replace(/\s+/g, " ").trim();
  let send = false;
  let stop = false;
  let scratch = false;
  let sentence = false;

  const take = (pattern: RegExp, flag: "send" | "stop" | "scratch" | "sentence") => {
    if (!pattern.test(text)) return;
    text = text.replace(pattern, " ").replace(/\s+/g, " ").trim();
    if (flag === "send") send = true;
    if (flag === "stop") stop = true;
    if (flag === "scratch") scratch = true;
    if (flag === "sentence") sentence = true;
  };

  take(/\b(?:scratch that|delete that|undo that|undo)\b/gi, "scratch");
  take(/\bdelete last sentence\b/gi, "sentence");
  take(/\b(?:stop listening|stop dictation|stop recording)\b/gi, "stop");
  take(/\b(?:press enter|hit enter|press return|send that|send it|send this|send)\s*$/gi, "send");

  text = text
    .replace(/\bnew paragraph\b/gi, "\n\n")
    .replace(/\bnew line\b/gi, "\n")
    .replace(/\bquestion mark\b/gi, "?")
    .replace(/\bexclamation (?:point|mark)\b/gi, "!")
    .replace(/\bperiod\b/gi, ".")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();

  return { text, send, stop, scratch, sentence };
}

export function joinUtterance(prefix: string, next: string): string {
  const left = prefix.replace(/\s+$/g, "");
  const right = next.replace(/^\s+/g, "");
  if (!left) return right;
  if (!right) return left;
  if (left.endsWith("\n")) return `${left}${right}`;
  return `${left} ${right}`;
}

export function dropLastUtterance(text: string, last: string): string {
  const trimmed = text.trimEnd();
  const needle = last.trim();
  if (needle && trimmed.endsWith(needle)) return trimmed.slice(0, trimmed.length - needle.length).trimEnd();
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(" ");
}

export function dropLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.?!])\s+/);
  if (parts.length <= 1) {
    const space = trimmed.lastIndexOf(" ");
    return space === -1 ? "" : trimmed.slice(0, space);
  }
  return parts.slice(0, -1).join(" ");
}
