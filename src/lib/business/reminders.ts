import { isClientDate, type WorkspaceClient } from "../client-workspace";

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function nextFollowUp(date: string, days = 7) {
  if (!isClientDate(date)) throw new Error("Choose a valid date.");
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
export function dueClients(clients: WorkspaceClient[], today = localDate()) {
  return clients
    .filter((c) => c.stage !== "archived" && c.followUpOn && c.followUpOn <= today)
    .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!) || a.name.localeCompare(b.name));
}
const escapeIcs = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&");
// RFC 5545 folding counts UTF-8 octets, not JS characters.
function fold(line: string) {
  const lines: string[] = [];
  let current = "";
  for (const char of line) {
    if (new TextEncoder().encode(current + char).length > 74) {
      lines.push(current);
      current = " ";
    }
    current += char;
  }
  return [...lines, current].join("\r\n");
}
export function reminderCalendar(clients: WorkspaceClient[], now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Celinen//Client follow-ups//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const c of clients.filter((c) => c.stage !== "archived" && isClientDate(c.followUpOn))) {
    rows.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(c.id)}@lenslabs`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${c.followUpOn!.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${nextFollowUp(c.followUpOn!, 1).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(`Follow up with ${c.name}`)}`,
      "DESCRIPTION:Open Celinen Clients to follow up.",
      "BEGIN:VALARM",
      "TRIGGER:-PT15H",
      "ACTION:DISPLAY",
      "DESCRIPTION:Client follow-up tomorrow",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  return [...rows, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
export function clientCsv(clients: WorkspaceClient[]) {
  const cell = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  return [
    ["Name", "Organization", "Email", "Phone", "Stage", "Follow up", "Source"],
    ...clients.map((c) => [c.name, c.org, c.email, c.phone, c.stage, c.followUpOn ?? "", c.source]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
