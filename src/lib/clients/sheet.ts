import {
  buildClientBooking,
  buildWorkspaceClient,
  upsertClientBooking,
  upsertWorkspaceClient,
  type ClientWorkspace,
  type WorkspaceClient,
} from "@/lib/client-workspace";

export const SHEET_STAGES = ["lead", "booked", "shot", "live", "delivered", "quiet"] as const;
export type SheetStage = (typeof SHEET_STAGES)[number];
export const JOB_TYPES = ["Wedding", "Portrait", "Brand", "Family"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const GALLERY_STATES = ["None", "Draft", "Live"] as const;
export type GalleryState = (typeof GALLERY_STATES)[number];
export const NDA_STATES = ["None", "Sent", "Signed"] as const;
export type NdaState = (typeof NDA_STATES)[number];
export const CHANNELS = ["Signal", "Email", "Manager"] as const;
export type Channel = (typeof CHANNELS)[number];
export const ON_OFF = ["On", "Off"] as const;
export type OnOff = (typeof ON_OFF)[number];
export const STRIP_STATES = ["Stripped", "Kept"] as const;
export type StripState = (typeof STRIP_STATES)[number];
export const SHEET_STORAGE_KEY = "iris.client-sheet.v1";
export const CLIENT_COMMAND_EVENT = "iris:client-command";

export type SheetExtra = {
  type: JobType | "";
  location: string;
  date: string;
  cover: string | null;
  receivedCents: number | null;
  totalCents: number | null;
  gallery: GalleryState | "";
  last: string;
  guest: string;
  clientPw: string;
  pin: string;
  sheetStage: SheetStage | "";
  alias: string;
  nda: NdaState | "";
  ndaOn: string;
  channel: Channel | "";
  /** Named watermark kit (legacy On/Off upgraded via resolveClientWatermarkKitName). */
  watermark: string;
  download: OnOff | "";
  expires: string;
  gps: StripState | "";
  serial: StripState | "";
  notes: string;
};

export type ClientRow = WorkspaceClient & SheetExtra & { initials: string };

export type ClientCommand =
  | { kind: "add"; name: string; type?: JobType; date?: string }
  | { kind: "open"; name: string }
  | { kind: "quiet" }
  | { kind: "unopened" }
  | { kind: "attach"; name: string };

export const SEED_IDS = {
  amara: "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1",
  lunara: "c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4",
  elise: "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2",
  maya: "b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3",
} as const;


/** Map legacy On/Off sheet values onto named watermark kits. */
export function normalizeSheetWatermark(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || /^off$/i.test(raw)) return "";
  if (/^on$/i.test(raw)) return "Client proof";
  return raw.slice(0, 40);
}

export function emptyExtra(): SheetExtra {
  return {
    type: "",
    location: "",
    date: "",
    cover: null,
    receivedCents: null,
    totalCents: null,
    gallery: "",
    last: "",
    guest: "",
    clientPw: "",
    pin: "",
    sheetStage: "",
    alias: "",
    nda: "",
    ndaOn: "",
    channel: "",
    watermark: "",
    download: "",
    expires: "",
    gps: "",
    serial: "",
    notes: "",
  };
}

const SEED_EXTRAS: Record<string, SheetExtra> = {
  [SEED_IDS.amara]: {
    type: "Wedding",
    location: "Napa",
    date: "2026-05-14",
    cover: "/clients/amara-james.jpg",
    receivedCents: 240_000,
    totalCents: 600_000,
    gallery: "Live",
    last: "",
    guest: "napa",
    clientPw: "amara",
    pin: "4821",
    sheetStage: "booked",
    alias: "",
    nda: "Signed",
    ndaOn: "2026-04-02",
    channel: "Email",
    watermark: "Client proof",
    download: "Off",
    expires: "2026-08-14",
    gps: "Stripped",
    serial: "Stripped",
    notes: "",
  },
  [SEED_IDS.lunara]: emptyExtra(),
  [SEED_IDS.elise]: {
    type: "Portrait",
    location: "New York",
    date: "2026-06-02",
    cover: "/clients/elise-moreau.jpg",
    receivedCents: null,
    totalCents: null,
    gallery: "Live",
    last: "",
    guest: "atelier",
    clientPw: "",
    pin: "1902",
    sheetStage: "live",
    alias: "Atelier",
    nda: "Signed",
    ndaOn: "2026-05-20",
    channel: "Signal",
    watermark: "Client proof",
    download: "Off",
    expires: "2026-07-02",
    gps: "Stripped",
    serial: "Stripped",
    notes: "",
  },
  [SEED_IDS.maya]: {
    ...emptyExtra(),
    type: "Wedding",
    date: "2026-10-03",
    sheetStage: "lead",
  },
};

export function initials(name: string) {
  const parts = name.replace(/&/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length >= 2)
    return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "·";
}

export function money(cents: number | null) {
  if (cents === null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function stageLabel(stage: SheetStage | "") {
  if (!stage) return "";
  return stage[0]!.toUpperCase() + stage.slice(1);
}

export function formatDate(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return value;
}

const memoryExtras: Record<string, SheetExtra> = {};

function readExtras(): Record<string, SheetExtra> {
  let stored: Record<string, SheetExtra> = {};
  try {
    const raw = localStorage.getItem(SHEET_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        stored = parsed as Record<string, SheetExtra>;
    }
  } catch {
    stored = {};
  }
  return { ...stored, ...memoryExtras };
}

export function writeExtra(id: string, extra: SheetExtra) {
  memoryExtras[id] = extra;
  try {
    localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify({ ...readExtras(), [id]: extra }));
  } catch {
    /* Sheet extras stay in this tab if storage is blocked. */
  }
}

function asJobType(value: string): JobType | "" {
  const hit = JOB_TYPES.find((type) => type.toLowerCase() === value.toLowerCase());
  return hit ?? "";
}

function defaultExtra(client: WorkspaceClient): SheetExtra {
  const booking = client.bookings[0];
  const saved = readExtras()[client.id];
  if (saved)
    return { ...saved, watermark: normalizeSheetWatermark(saved.watermark) };
  const stage: SheetStage | "" =
    client.stage === "archived"
      ? "quiet"
      : client.stage === "delivered"
        ? "delivered"
        : client.stage === "booked"
          ? "booked"
          : client.stage === "new"
            ? ""
            : "lead";
  return {
    type: asJobType(client.source),
    location: client.org,
    date: booking?.date ?? "",
    cover: null,
    receivedCents: null,
    totalCents: client.budgetCents,
    gallery: client.galleryIds.length ? "Draft" : "",
    last: "",
    guest: "",
    clientPw: "",
    pin: "",
    sheetStage: stage,
    alias: "",
    nda: "",
    ndaOn: "",
    channel: "",
    watermark: "",
    download: "",
    expires: "",
    gps: "",
    serial: "",
    notes: "",
  };
}

export function toRow(client: WorkspaceClient): ClientRow {
  const extra = defaultExtra(client);
  return { ...client, ...extra, initials: initials(client.name) };
}

function seedClient(
  id: string,
  name: string,
  input: {
    org: string;
    source: string;
    budget: string;
    stage: WorkspaceClient["stage"];
    now: string;
  },
  booking?: {
    title: string;
    date: string;
    location: string;
    status: WorkspaceClient["bookings"][number]["status"];
  },
): WorkspaceClient {
  const built = buildWorkspaceClient(
    {
      name,
      org: input.org,
      email: "",
      phone: "",
      source: input.source,
      brief: "",
      followUpOn: "",
      budget: input.budget,
      stage: input.stage,
    },
    undefined,
    { id, now: input.now },
  );
  if (!built.ok) throw new Error(built.error);
  if (!booking) return built.value;
  const booked = buildClientBooking(booking, undefined, { now: input.now });
  if (!booked.ok) throw new Error(booked.error);
  return upsertClientBooking(built.value, booked.value);
}

export function ensureSeedClients(
  state: ClientWorkspace,
  now = "2026-09-07T20:00:00.000Z",
): ClientWorkspace {
  const seeds: WorkspaceClient[] = [
    seedClient(
      SEED_IDS.amara,
      "Amara & James",
      { org: "Napa", source: "Wedding", budget: "6000", stage: "booked", now },
      { title: "Wedding", date: "2026-05-14", location: "Napa", status: "confirmed" },
    ),
    seedClient(SEED_IDS.lunara, "Lunara Glow Beauty Salon", {
      org: "",
      source: "",
      budget: "",
      stage: "new",
      now,
    }),
    seedClient(
      SEED_IDS.elise,
      "Elise Moreau",
      { org: "New York", source: "Portrait", budget: "", stage: "booked", now },
      { title: "Portrait", date: "2026-06-02", location: "New York", status: "completed" },
    ),
    seedClient(
      SEED_IDS.maya,
      "Maya Shah",
      { org: "", source: "Wedding", budget: "", stage: "new", now },
      { title: "Wedding", date: "2026-10-03", location: "", status: "requested" },
    ),
  ];
  let next = state;
  let changed = false;
  for (const seed of seeds) {
    if (!next.clients.some((client) => client.id === seed.id)) {
      next = upsertWorkspaceClient(next, seed);
      changed = true;
    }
    writeExtra(seed.id, SEED_EXTRAS[seed.id]!);
  }
  const order = seeds.map((seed) => seed.id);
  const needsOrder = order.some((id, index) => next.clients[index]?.id !== id);
  if (!changed && !needsOrder) return state;
  return {
    ...next,
    clients: [
      ...order.map((id) => next.clients.find((client) => client.id === id)!),
      ...next.clients.filter((client) => !order.includes(client.id)),
    ],
  };
}

let pendingCommand: ClientCommand | null = null;

export function dispatchClientCommand(command: ClientCommand) {
  pendingCommand = command;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CLIENT_COMMAND_EVENT, { detail: command }));
  }
}

export function takePendingClientCommand() {
  const command = pendingCommand;
  pendingCommand = null;
  return command;
}

export function parseClientCommand(text: string): ClientCommand | null {
  const value = text.trim();
  const add = value.match(
    /^add lead\s+([^,]+)(?:,\s*(wedding|portrait|brand|family))?(?:\s+(.+))?$/i,
  );
  if (add) {
    const type = add[2]
      ? ((add[2][0]!.toUpperCase() + add[2].slice(1).toLowerCase()) as JobType)
      : undefined;
    const date = add[3]?.trim();
    return {
      kind: "add",
      name: add[1]!.trim(),
      ...(type ? { type } : {}),
      ...(date ? { date } : {}),
    };
  }
  const open = value.match(/^open\s+(.+?)[.!]?$/i);
  if (
    open &&
    !/^(the\s+)?(studio|clients?|settings|chat|workspace|delivery|earnings)\b/i.test(open[1]!)
  )
    return { kind: "open", name: open[1]!.trim() };
  if (/^who is quiet[.!]?$/i.test(value)) return { kind: "quiet" };
  if (/^who hasn['’]?t opened their gallery[.!]?$/i.test(value)) return { kind: "unopened" };
  const attach = value.match(/^attach\s+(.+?)\s+to a new project[.!]?$/i);
  if (attach) return { kind: "attach", name: attach[1]!.trim() };
  return null;
}

export function findClient(rows: readonly ClientRow[], name: string) {
  const needle = name.trim().toLowerCase();
  return (
    rows.find((row) => row.name.toLowerCase() === needle) ??
    rows.find((row) => row.alias.toLowerCase() === needle) ??
    rows.find(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.alias.toLowerCase().includes(needle) ||
        row.clientPw === needle,
    )
  );
}
