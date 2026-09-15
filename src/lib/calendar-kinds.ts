export const CALENDAR_KINDS = [
  "shoot",
  "edit",
  "delivery",
  "meeting",
  "travel",
  "personal",
  "task",
] as const;

export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const KIND_COLOR: Record<CalendarKind, string> = {
  shoot: "#2f6fed",
  edit: "#7c5cbf",
  delivery: "#e25d8a",
  meeting: "#2f9d6a",
  travel: "#8a8f98",
  personal: "#6b7280",
  task: "#c9a227",
};

export const KIND_LABEL: Record<CalendarKind, string> = {
  shoot: "Shoot",
  edit: "Editing",
  delivery: "Delivery",
  meeting: "Meeting",
  travel: "Travel",
  personal: "Personal",
  task: "Task",
};

const SLASH: Record<string, CalendarKind> = {
  shoot: "shoot",
  edit: "edit",
  editing: "edit",
  delivery: "delivery",
  deliver: "delivery",
  travel: "travel",
  personal: "personal",
  meeting: "meeting",
  task: "task",
};

export function isCalendarKind(value: string): value is CalendarKind {
  return (CALENDAR_KINDS as readonly string[]).includes(value);
}

export function kindFromSlash(text: string): { rest: string; kind: CalendarKind | null } {
  const match = text.match(/\s\/(shoot|edit|editing|delivery|deliver|travel|personal|meeting|task)\b/i);
  if (!match) return { rest: text, kind: null };
  const kind = SLASH[match[1]!.toLowerCase()] ?? null;
  return { rest: text.replace(match[0], " ").replace(/\s+/g, " ").trim(), kind };
}

export function inferCalendarKind(title: string): CalendarKind {
  const t = title.toLowerCase();
  if (/\b(deliver|delivery|gallery|deadline|invoice)\b/.test(t)) return "delivery";
  if (/\b(edit|cull|selects|post-prod|post production)\b/.test(t)) return "edit";
  if (/\b(travel|drive|call time)\b/.test(t)) return "travel";
  if (/\b(client call|meeting|call with)\b/.test(t)) return "meeting";
  if (/\b(wedding|game|soccer|football|shoot|portraits?|session)\b/.test(t)) return "shoot";
  return "shoot";
}

export type ViewSet = "everything" | "shoots" | "post" | "business";

export function kindInViewSet(kind: CalendarKind, set: ViewSet): boolean {
  if (set === "everything") return true;
  if (set === "shoots") return kind === "shoot" || kind === "travel";
  if (set === "post") return kind === "edit" || kind === "delivery" || kind === "task";
  return kind === "meeting" || kind === "delivery" || kind === "task";
}
