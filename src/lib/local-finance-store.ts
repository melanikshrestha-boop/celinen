export const LOCAL_FINANCE_STORAGE_KEY = "lenslabs.local-finance.v1";

export type LocalLedgerKind = "income" | "expense";

export interface LocalLedgerEntry {
  id: string;
  occurredOn: string;
  description: string;
  kind: LocalLedgerKind;
  category: string;
  amountCents: number;
  shootId: string | null;
  source: "manual";
  createdAt: string;
  updatedAt: string;
}

export interface LocalInvoiceDraft {
  id: string;
  /** Exact local CRM identity when explicitly selected; absent on legacy drafts. */
  clientId?: string | null;
  clientName: string;
  clientEmail: string | null;
  description: string;
  amountCents: number;
  dueDate: string | null;
  status: "draft";
  createdAt: string;
  updatedAt: string;
}

export interface LocalFinanceState {
  version: 1;
  revision: number;
  entries: LocalLedgerEntry[];
  invoices: LocalInvoiceDraft[];
  updatedAt: string | null;
}

export interface LocalFinanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LocalFinanceLoadResult =
  | { ok: true; state: LocalFinanceState; warning: null }
  | { ok: false; state: LocalFinanceState; warning: string };

export type LocalFinanceSaveResult =
  | { ok: true; state: LocalFinanceState }
  | {
      ok: false;
      error: string;
      reason: "unavailable" | "invalid" | "conflict" | "write";
      currentState?: LocalFinanceState;
    };

export interface LocalFinanceLockManager {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

export type LocalFinanceBuildResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDateOnly = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isPositiveCents = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isLedgerEntry = (value: unknown): value is LocalLedgerEntry => {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    isDateOnly(value["occurredOn"]) &&
    typeof value["description"] === "string" &&
    value["description"].length > 0 &&
    (value["kind"] === "income" || value["kind"] === "expense") &&
    typeof value["category"] === "string" &&
    value["category"].length > 0 &&
    isPositiveCents(value["amountCents"]) &&
    isNullableString(value["shootId"]) &&
    value["source"] === "manual" &&
    isIsoTimestamp(value["createdAt"]) &&
    isIsoTimestamp(value["updatedAt"])
  );
};

const isInvoiceDraft = (value: unknown): value is LocalInvoiceDraft => {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    (value["clientId"] === undefined ||
      value["clientId"] === null ||
      (typeof value["clientId"] === "string" && value["clientId"].length > 0)) &&
    typeof value["clientName"] === "string" &&
    value["clientName"].length > 0 &&
    isNullableString(value["clientEmail"]) &&
    typeof value["description"] === "string" &&
    value["description"].length > 0 &&
    isPositiveCents(value["amountCents"]) &&
    (value["dueDate"] === null || isDateOnly(value["dueDate"])) &&
    value["status"] === "draft" &&
    isIsoTimestamp(value["createdAt"]) &&
    isIsoTimestamp(value["updatedAt"])
  );
};

const hasUniqueIds = (values: { id: string }[]): boolean =>
  new Set(values.map((value) => value.id)).size === values.length;

type StoredLocalFinanceState = Omit<LocalFinanceState, "revision"> & { revision?: number };

const isFinanceState = (value: unknown): value is StoredLocalFinanceState => {
  if (!isRecord(value)) return false;
  return (
    value["version"] === 1 &&
    (value["revision"] === undefined ||
      (typeof value["revision"] === "number" &&
        Number.isSafeInteger(value["revision"]) &&
        value["revision"] >= 0)) &&
    Array.isArray(value["entries"]) &&
    value["entries"].every(isLedgerEntry) &&
    hasUniqueIds(value["entries"]) &&
    Array.isArray(value["invoices"]) &&
    value["invoices"].every(isInvoiceDraft) &&
    hasUniqueIds(value["invoices"]) &&
    (value["updatedAt"] === null || isIsoTimestamp(value["updatedAt"]))
  );
};

const browserStorage = (): LocalFinanceStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const browserLockManager = (): LocalFinanceLockManager | null => {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return navigator.locks as LocalFinanceLockManager;
};

const LOCAL_FINANCE_WRITE_LOCK = `${LOCAL_FINANCE_STORAGE_KEY}.write`;

export const emptyLocalFinanceState = (): LocalFinanceState => ({
  version: 1,
  revision: 0,
  entries: [],
  invoices: [],
  updatedAt: null,
});

/**
 * Reads the local ledger as one atomic snapshot. Invalid snapshots are left untouched
 * and reported as read-only so a later save cannot silently replace recoverable data.
 */
export function loadLocalFinanceState(
  storage: LocalFinanceStorage | null = browserStorage(),
): LocalFinanceLoadResult {
  if (!storage) {
    return {
      ok: false,
      state: emptyLocalFinanceState(),
      warning: "Local browser storage is unavailable. Your saved finance data was not changed.",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(LOCAL_FINANCE_STORAGE_KEY);
  } catch {
    return {
      ok: false,
      state: emptyLocalFinanceState(),
      warning: "The local finance ledger could not be read. Its stored data was not changed.",
    };
  }

  if (raw === null) return { ok: true, state: emptyLocalFinanceState(), warning: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isFinanceState(parsed)) {
      return {
        ok: false,
        state: emptyLocalFinanceState(),
        warning:
          "The saved local finance ledger has an unsupported format. It is preserved and editing is paused.",
      };
    }
    return {
      ok: true,
      state: { ...parsed, revision: parsed.revision ?? 0 },
      warning: null,
    };
  } catch {
    return {
      ok: false,
      state: emptyLocalFinanceState(),
      warning:
        "The saved local finance ledger could not be decoded. It is preserved and editing is paused.",
    };
  }
}

export function saveLocalFinanceState(
  state: LocalFinanceState,
  storage: LocalFinanceStorage | null = browserStorage(),
  now = new Date().toISOString(),
): LocalFinanceSaveResult {
  if (!storage) {
    return {
      ok: false,
      error: "Local browser storage is unavailable.",
      reason: "unavailable",
    };
  }

  const current = loadLocalFinanceState(storage);
  if (!current.ok) {
    return {
      ok: false,
      error: "The saved local finance ledger changed or became unreadable. It was preserved.",
      reason: "invalid",
    };
  }
  if (current.state.revision !== state.revision) {
    return {
      ok: false,
      error:
        "The local finance ledger changed in another tab. The latest saved data was loaded; retry your change.",
      reason: "conflict",
      currentState: current.state,
    };
  }

  const next: LocalFinanceState = {
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
  };
  if (!isFinanceState(next)) {
    return {
      ok: false,
      error: "The local finance update was invalid and was not saved.",
      reason: "invalid",
    };
  }

  try {
    storage.setItem(LOCAL_FINANCE_STORAGE_KEY, JSON.stringify(next));
    return { ok: true, state: next };
  } catch {
    return {
      ok: false,
      error: "The local finance update could not be saved.",
      reason: "write",
    };
  }
}

/**
 * Browser writes are serialized across tabs, then checked against the revision the
 * caller loaded. This makes a stale tab fail closed instead of replacing newer data.
 */
export async function commitLocalFinanceState(
  state: LocalFinanceState,
  options: {
    storage?: LocalFinanceStorage | null;
    lockManager?: LocalFinanceLockManager | null;
    now?: string;
  } = {},
): Promise<LocalFinanceSaveResult> {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (!storage) {
    return {
      ok: false,
      error: "Local browser storage is unavailable.",
      reason: "unavailable",
    };
  }

  const lockManager =
    options.lockManager === undefined ? browserLockManager() : options.lockManager;
  if (!lockManager) {
    return {
      ok: false,
      error: "Safe cross-tab finance locking is unavailable. Nothing was changed.",
      reason: "unavailable",
    };
  }

  try {
    return await lockManager.request(LOCAL_FINANCE_WRITE_LOCK, () =>
      saveLocalFinanceState(state, storage, options.now),
    );
  } catch {
    return {
      ok: false,
      error: "The local finance update could not acquire its safe write lock.",
      reason: "write",
    };
  }
}

/** Parse user-entered dollars without floating-point rounding. */
export function parseCurrencyToCents(input: string): number | null {
  const entered = input.trim().replace(/^\$/, "");
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\.\d{1,2})$/.test(entered)) {
    return null;
  }
  const normalized = entered.replaceAll(",", "");

  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const localId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function buildLocalLedgerEntry(
  input: {
    occurredOn: string;
    description: string;
    kind: LocalLedgerKind;
    category: string;
    amount: string;
    shootId: string | null;
  },
  identity: { id?: string; createdAt?: string; now?: string } = {},
): LocalFinanceBuildResult<LocalLedgerEntry> {
  const description = input.description.trim();
  const category = input.category.trim();
  const amountCents = parseCurrencyToCents(input.amount);
  if (!isDateOnly(input.occurredOn)) return { ok: false, error: "Choose a valid date." };
  if (!description) return { ok: false, error: "Add a description." };
  if (!category) return { ok: false, error: "Choose a category." };
  if (amountCents === null)
    return { ok: false, error: "Enter a positive amount with up to two decimals." };

  const now = identity.now ?? new Date().toISOString();
  return {
    ok: true,
    value: {
      id: identity.id ?? localId("ledger"),
      occurredOn: input.occurredOn,
      description,
      kind: input.kind,
      category,
      amountCents,
      shootId: input.shootId,
      source: "manual",
      createdAt: identity.createdAt ?? now,
      updatedAt: now,
    },
  };
}

export function buildLocalInvoiceDraft(
  input: {
    clientId?: string | null;
    clientName: string;
    clientEmail: string;
    description: string;
    amount: string;
    dueDate: string;
  },
  identity: { id?: string; createdAt?: string; now?: string } = {},
): LocalFinanceBuildResult<LocalInvoiceDraft> {
  const clientName = input.clientName.trim();
  const clientEmail = input.clientEmail.trim() || null;
  const description = input.description.trim();
  const amountCents = parseCurrencyToCents(input.amount);
  const dueDate = input.dueDate || null;

  if (!clientName) return { ok: false, error: "Add a client name." };
  if (!description) return { ok: false, error: "Describe the photography work." };
  if (amountCents === null)
    return { ok: false, error: "Enter a positive amount with up to two decimals." };
  if (dueDate !== null && !isDateOnly(dueDate))
    return { ok: false, error: "Choose a valid due date." };

  const now = identity.now ?? new Date().toISOString();
  return {
    ok: true,
    value: {
      id: identity.id ?? localId("invoice"),
      clientId: input.clientId ?? null,
      clientName,
      clientEmail,
      description,
      amountCents,
      dueDate,
      status: "draft",
      createdAt: identity.createdAt ?? now,
      updatedAt: now,
    },
  };
}

export function upsertLocalLedgerEntry(
  state: LocalFinanceState,
  entry: LocalLedgerEntry,
): LocalFinanceState {
  const exists = state.entries.some((candidate) => candidate.id === entry.id);
  return {
    ...state,
    entries: exists
      ? state.entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
      : [entry, ...state.entries],
  };
}

export function deleteLocalLedgerEntry(
  state: LocalFinanceState,
  entryId: string,
): LocalFinanceState {
  return { ...state, entries: state.entries.filter((entry) => entry.id !== entryId) };
}

export function upsertLocalInvoiceDraft(
  state: LocalFinanceState,
  invoice: LocalInvoiceDraft,
): LocalFinanceState {
  const exists = state.invoices.some((candidate) => candidate.id === invoice.id);
  return {
    ...state,
    invoices: exists
      ? state.invoices.map((candidate) => (candidate.id === invoice.id ? invoice : candidate))
      : [invoice, ...state.invoices],
  };
}

export function deleteLocalInvoiceDraft(
  state: LocalFinanceState,
  invoiceId: string,
): LocalFinanceState {
  return { ...state, invoices: state.invoices.filter((invoice) => invoice.id !== invoiceId) };
}
