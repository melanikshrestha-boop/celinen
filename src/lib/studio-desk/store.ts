import { detectTimeZone } from "./timezones";

export const SESSION_TYPES = [
  "Game day",
  "Sideline",
  "Team day",
  "Athlete portraits",
  "Editorial",
  "Bowl / playoff",
] as const;

export type TemplateKind = "contract" | "invoice" | "questionnaire" | "quote";

export type DeskSession = {
  id: string;
  type: string;
  title: string;
  startIso: string;
  client: string;
};

export type DeskTemplate = {
  id: string;
  kind: TemplateKind;
  name: string;
  body: string;
  createdAt: number;
  signedBy?: string;
  signedAt?: string;
  signature?: string;
};

export type StudioDeskState = {
  timezone: string;
  timezoneConfirmed: boolean;
  types: string[];
  sessions: DeskSession[];
  templates: DeskTemplate[];
};

function key(scope: string) {
  return `celinen.studio-desk.v1:${scope}`;
}
function publicKey() {
  return "celinen.studio-desk.public.v1";
}

export function emptyDesk(): StudioDeskState {
  return {
    timezone: detectTimeZone(),
    timezoneConfirmed: false,
    types: [...SESSION_TYPES],
    sessions: [],
    templates: [],
  };
}

export function readDesk(scope: string): StudioDeskState {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(scope)) ?? "null") as Partial<StudioDeskState> | null;
    if (!parsed || typeof parsed !== "object") return emptyDesk();
    const base = emptyDesk();
    return {
      timezone: typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : base.timezone,
      timezoneConfirmed: parsed.timezoneConfirmed === true,
      types: Array.isArray(parsed.types) && parsed.types.length ? parsed.types.map(String) : base.types,
      sessions: Array.isArray(parsed.sessions) ? (parsed.sessions as DeskSession[]) : [],
      templates: Array.isArray(parsed.templates) ? (parsed.templates as DeskTemplate[]) : [],
    };
  } catch {
    return emptyDesk();
  }
}

export function writeDesk(scope: string, state: StudioDeskState) {
  localStorage.setItem(key(scope), JSON.stringify(state));
  localStorage.setItem(
    publicKey(),
    JSON.stringify({
      timezone: state.timezone,
      types: state.types,
      sessions: state.sessions.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        startIso: row.startIso,
      })),
    }),
  );
}

export function readPublicDesk() {
  try {
    const parsed = JSON.parse(localStorage.getItem(publicKey()) ?? "null") as {
      timezone?: string;
      types?: string[];
      sessions?: { id: string; title: string; type: string; startIso: string }[];
    } | null;
    if (!parsed) return { timezone: detectTimeZone(), types: [...SESSION_TYPES], sessions: [] as DeskSession[] };
    return {
      timezone: parsed.timezone || detectTimeZone(),
      types: parsed.types?.length ? parsed.types : [...SESSION_TYPES],
      sessions: parsed.sessions ?? [],
    };
  } catch {
    return { timezone: detectTimeZone(), types: [...SESSION_TYPES], sessions: [] as DeskSession[] };
  }
}
