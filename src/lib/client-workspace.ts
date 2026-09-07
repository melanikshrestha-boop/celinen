import { parseCurrencyToCents, type LocalInvoiceDraft } from "@/lib/local-finance-store";

export const CLIENT_WORKSPACE_KEY = "lenslabs.client-workspace.v1";
export const CLIENT_STAGES = [
  "new",
  "contacted",
  "quoted",
  "booked",
  "delivered",
  "archived",
] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];
export const BOOKING_STATUSES = ["requested", "confirmed", "completed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface ClientBooking {
  id: string;
  title: string;
  date: string;
  location: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceClient {
  id: string;
  name: string;
  org: string;
  email: string;
  phone: string;
  source: string;
  brief: string;
  followUpOn: string | null;
  budgetCents: number | null;
  stage: ClientStage;
  bookings: ClientBooking[];
  galleryIds: string[];
  invoiceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClientWorkspace {
  version: 1;
  revision: number;
  clients: WorkspaceClient[];
  updatedAt: string | null;
}

export interface ClientWorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface ClientWorkspaceLocks {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}
type BuildResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type WorkspaceLoad = { ok: true; state: ClientWorkspace } | { ok: false; error: string };
export type WorkspaceSave =
  WorkspaceLoad | { ok: false; error: string; currentState: ClientWorkspace };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const timestamp = (value: unknown): value is string =>
  text(value) && Number.isFinite(Date.parse(value));
export const isClientDate = (value: unknown): value is string => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const uniqueIds = (values: { id: string }[]) =>
  new Set(values.map((value) => value.id)).size === values.length;
const idList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((id) => text(id) && id.length > 0) &&
  new Set(value).size === value.length;

function isBooking(value: unknown): value is ClientBooking {
  return (
    record(value) &&
    text(value["id"]) &&
    value["id"].length > 0 &&
    text(value["title"]) &&
    value["title"].trim().length > 0 &&
    isClientDate(value["date"]) &&
    text(value["location"]) &&
    BOOKING_STATUSES.includes(value["status"] as BookingStatus) &&
    timestamp(value["createdAt"]) &&
    timestamp(value["updatedAt"])
  );
}

function isClient(value: unknown): value is WorkspaceClient {
  return (
    record(value) &&
    text(value["id"]) &&
    value["id"].length > 0 &&
    text(value["name"]) &&
    value["name"].trim().length > 0 &&
    ["org", "email", "phone", "source", "brief"].every((key) => text(value[key])) &&
    (value["followUpOn"] === null || isClientDate(value["followUpOn"])) &&
    (value["budgetCents"] === null ||
      (Number.isSafeInteger(value["budgetCents"]) && Number(value["budgetCents"]) > 0)) &&
    CLIENT_STAGES.includes(value["stage"] as ClientStage) &&
    Array.isArray(value["bookings"]) &&
    value["bookings"].every(isBooking) &&
    uniqueIds(value["bookings"]) &&
    idList(value["galleryIds"]) &&
    idList(value["invoiceIds"]) &&
    timestamp(value["createdAt"]) &&
    timestamp(value["updatedAt"])
  );
}

export function isClientWorkspace(value: unknown): value is ClientWorkspace {
  return (
    record(value) &&
    value["version"] === 1 &&
    Number.isSafeInteger(value["revision"]) &&
    Number(value["revision"]) >= 0 &&
    Array.isArray(value["clients"]) &&
    value["clients"].every(isClient) &&
    uniqueIds(value["clients"]) &&
    (value["updatedAt"] === null || timestamp(value["updatedAt"]))
  );
}

function browserStorage(): ClientWorkspaceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
function browserLocks(): ClientWorkspaceLocks | null {
  return typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
}
export const emptyClientWorkspace = (): ClientWorkspace => ({
  version: 1,
  revision: 0,
  clients: [],
  updatedAt: null,
});

/** All-or-nothing validation: unreadable data is never replaced with an empty list. */
export function loadClientWorkspace(
  storage: ClientWorkspaceStorage | null = browserStorage(),
): WorkspaceLoad {
  if (!storage)
    return { ok: false, error: "Local client storage is unavailable. Nothing was changed." };
  try {
    const raw = storage.getItem(CLIENT_WORKSPACE_KEY);
    if (raw === null) return { ok: true, state: emptyClientWorkspace() };
    const parsed: unknown = JSON.parse(raw);
    if (!isClientWorkspace(parsed))
      return {
        ok: false,
        error:
          "Saved client records need recovery. Editing is paused and the original data is preserved.",
      };
    return { ok: true, state: parsed };
  } catch {
    return {
      ok: false,
      error: "Saved clients could not be read. Their stored data has not been changed.",
    };
  }
}

export function saveClientWorkspace(
  state: ClientWorkspace,
  storage: ClientWorkspaceStorage | null = browserStorage(),
  now = new Date().toISOString(),
): WorkspaceSave {
  const loaded = loadClientWorkspace(storage);
  if (!loaded.ok) return loaded;
  if (loaded.state.revision !== state.revision)
    return {
      ok: false,
      error:
        "Clients changed in another tab. The latest records were loaded. Cancel and reopen this form before editing again.",
      currentState: loaded.state,
    };
  const next = { ...state, revision: state.revision + 1, updatedAt: now };
  if (!isClientWorkspace(next))
    return { ok: false, error: "This client update was invalid and was not saved." };
  try {
    storage!.setItem(CLIENT_WORKSPACE_KEY, JSON.stringify(next));
    return { ok: true, state: next };
  } catch {
    return {
      ok: false,
      error: "Client changes could not be saved. Keep this page open and try again.",
    };
  }
}

/** Lock first, then compare revisions so two tabs cannot silently replace each other. */
export async function commitClientWorkspace(
  state: ClientWorkspace,
  options: {
    storage?: ClientWorkspaceStorage | null;
    locks?: ClientWorkspaceLocks | null;
    now?: string;
  } = {},
): Promise<WorkspaceSave> {
  const locks = options.locks === undefined ? browserLocks() : options.locks;
  if (!locks)
    return {
      ok: false,
      error: "Safe cross-tab client storage is unavailable. Nothing was changed.",
    };
  try {
    return await locks.request(`${CLIENT_WORKSPACE_KEY}.write`, () =>
      saveClientWorkspace(
        state,
        options.storage === undefined ? browserStorage() : options.storage,
        options.now,
      ),
    );
  } catch {
    return { ok: false, error: "The safe client write lock was unavailable. Please retry." };
  }
}

export interface ClientInput {
  name: string;
  org: string;
  email: string;
  phone: string;
  source: string;
  brief: string;
  followUpOn: string;
  budget: string;
  stage: ClientStage;
}
export const emptyClientInput = (): ClientInput => ({
  name: "",
  org: "",
  email: "",
  phone: "",
  source: "",
  brief: "",
  followUpOn: "",
  budget: "",
  stage: "new",
});
export function clientToInput(client: WorkspaceClient): ClientInput {
  return {
    ...client,
    followUpOn: client.followUpOn ?? "",
    budget: client.budgetCents === null ? "" : (client.budgetCents / 100).toFixed(2),
  };
}
export function buildWorkspaceClient(
  input: ClientInput,
  existing?: WorkspaceClient,
  identity: { id?: string; now?: string } = {},
): BuildResult<WorkspaceClient> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) return { ok: false, error: "Add the client's name." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "Enter a valid email address, or leave it blank." };
  if (input.followUpOn && !isClientDate(input.followUpOn))
    return { ok: false, error: "Choose a valid follow-up date." };
  const budgetCents = input.budget.trim() ? parseCurrencyToCents(input.budget) : null;
  if (input.budget.trim() && budgetCents === null)
    return {
      ok: false,
      error: "Enter a positive budget with at most two decimals, or leave it blank.",
    };
  const now = identity.now ?? new Date().toISOString();
  const client: WorkspaceClient = {
    id: existing?.id ?? identity.id ?? crypto.randomUUID(),
    name,
    org: input.org.trim(),
    email,
    phone: input.phone.trim(),
    source: input.source.trim(),
    brief: input.brief.trim(),
    followUpOn: input.followUpOn || null,
    budgetCents,
    stage: input.stage,
    bookings: existing?.bookings ?? [],
    galleryIds: existing?.galleryIds ?? [],
    invoiceIds: existing?.invoiceIds ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return isClient(client)
    ? { ok: true, value: client }
    : { ok: false, error: "This client record is invalid." };
}

export function buildClientBooking(
  input: { title: string; date: string; location: string; status: BookingStatus },
  existing?: ClientBooking,
  identity: { id?: string; now?: string } = {},
): BuildResult<ClientBooking> {
  if (!input.title.trim()) return { ok: false, error: "Name the shoot." };
  if (!isClientDate(input.date)) return { ok: false, error: "Choose a valid shoot date." };
  const now = identity.now ?? new Date().toISOString();
  const booking: ClientBooking = {
    ...input,
    title: input.title.trim(),
    location: input.location.trim(),
    id: existing?.id ?? identity.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return isBooking(booking)
    ? { ok: true, value: booking }
    : { ok: false, error: "This booking is invalid." };
}

export function upsertWorkspaceClient(
  state: ClientWorkspace,
  client: WorkspaceClient,
): ClientWorkspace {
  return {
    ...state,
    clients: state.clients.some((row) => row.id === client.id)
      ? state.clients.map((row) => (row.id === client.id ? client : row))
      : [...state.clients, client],
  };
}

export function upsertClientBooking(
  client: WorkspaceClient,
  booking: ClientBooking,
): WorkspaceClient {
  return {
    ...client,
    stage: booking.status === "confirmed" ? "booked" : client.stage,
    bookings: client.bookings.some((row) => row.id === booking.id)
      ? client.bookings.map((row) => (row.id === booking.id ? booking : row))
      : [...client.bookings, booking],
    updatedAt: booking.updatedAt,
  };
}

/** References are explicit IDs, never inferred from a shared client name or email. */
export function linkClientDraft(
  client: WorkspaceClient,
  kind: "gallery" | "invoice",
  id: string,
  linked: boolean,
): WorkspaceClient {
  const key = kind === "gallery" ? "galleryIds" : "invoiceIds";
  return {
    ...client,
    [key]: linked
      ? [...new Set([...client[key], id])]
      : client[key].filter((entry) => entry !== id),
    updatedAt: new Date().toISOString(),
  };
}

export interface InvoiceClientContact {
  clientId: string | null;
  name: string;
  email: string;
}

/** Existing name/email option keys stay stable. CRM identities use their exact IDs. */
export function invoiceClientKey(contact: InvoiceClientContact): string {
  return contact.clientId
    ? `client:${contact.clientId}`
    : JSON.stringify([contact.name, contact.email]);
}

export function invoiceClientOptions(
  clients: WorkspaceClient[],
  invoices: LocalInvoiceDraft[],
  selected?: InvoiceClientContact,
): Array<[string, InvoiceClientContact]> {
  const contacts = new Map<string, InvoiceClientContact>();
  for (const invoice of invoices) {
    const contact = {
      clientId: invoice.clientId ?? null,
      name: invoice.clientName,
      email: invoice.clientEmail ?? "",
    };
    contacts.set(invoiceClientKey(contact), contact);
  }
  for (const client of clients) {
    const contact = { clientId: client.id, name: client.name, email: client.email };
    contacts.set(invoiceClientKey(contact), contact);
  }
  // Keep a draft's chosen contact snapshot while a user edits it, even if the CRM changed.
  if (selected?.name) contacts.set(invoiceClientKey(selected), selected);
  return [...contacts.entries()];
}
