import { chatSchema, type ChatRecord } from "./chat-history";

export function clientTranscript(record: ChatRecord) {
  const safe = chatSchema.parse(record);
  return {
    title: safe.title,
    messages: safe.messages
      .filter((message) => !message.privateConnector)
      .map(({ role, text }) => ({ role, text })),
  };
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
export function chatShareHtml(record: ChatRecord) {
  const transcript = clientTranscript(record);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(transcript.title)} — Celinen</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:0;color:#191919;background:#fff}main{max-width:720px;margin:auto;padding:32px 20px}h1{font-size:28px;line-height:1.2}article{margin:30px 0}h2{font-size:13px;color:#646464}p{white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:12px;color:#666}</style><main><h1>${escapeHtml(transcript.title)}</h1>${transcript.messages.map((message) => `<article><h2>${message.role === "user" ? "Photographer" : "Celinen"}</h2><p>${escapeHtml(message.text)}</p></article>`).join("")}<footer>Shared conversation snapshot. Private connector requests, tool details, unsent drafts and original photos are not included.</footer></main></html>`;
}
export function dashboardChatRecord(thread: {
  id: string;
  title: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  updatedAt: number;
}): ChatRecord {
  const stamp = Math.max(1, Math.floor(thread.updatedAt) || Date.now());
  return chatSchema.parse({
    id: thread.id,
    project: "home",
    title: thread.title.trim().slice(0, 80) || "Chat",
    named: true,
    archived: false,
    pinned: false,
    section: "",
    unread: false,
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
    messages: thread.messages.map(({ role, text }) => ({ role, text: text.slice(0, 32_000) })),
    draft: "",
  });
}

export function chatCopyText(record: ChatRecord) {
  const transcript = clientTranscript(record);
  return transcript.messages
    .map((message) => `${message.role === "user" ? "You" : "Celinen"}\n${message.text}`)
    .join("\n\n");
}

export function chatShareFile(record: ChatRecord) {
  const name =
    record.title
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 60) || "conversation";
  return new File([chatShareHtml(record)], `${name}-Celinen.html`, { type: "text/html" });
}
