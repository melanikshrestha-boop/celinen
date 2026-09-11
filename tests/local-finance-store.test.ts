import { describe, expect, test } from "bun:test";
import {
  LOCAL_FINANCE_STORAGE_KEY,
  buildLocalInvoiceDraft,
  buildLocalLedgerEntry,
  deleteLocalInvoiceDraft,
  deleteLocalLedgerEntry,
  emptyLocalFinanceState,
  loadLocalFinanceState,
  parseCurrencyToCents,
  saveLocalFinanceState,
  upsertLocalInvoiceDraft,
  upsertLocalLedgerEntry,
  type LocalFinanceStorage,
} from "../src/lib/local-finance-store";

class MemoryStorage implements LocalFinanceStorage {
  value: string | null;
  writes = 0;
  failWrites = false;

  constructor(value: string | null = null) {
    this.value = value;
  }

  getItem(key: string): string | null {
    expect(key).toBe(LOCAL_FINANCE_STORAGE_KEY);
    return this.value;
  }

  setItem(key: string, value: string): void {
    expect(key).toBe(LOCAL_FINANCE_STORAGE_KEY);
    this.writes += 1;
    if (this.failWrites) throw new Error("quota exceeded");
    this.value = value;
  }
}

const now = "2026-09-04T12:00:00.000Z";

const ledgerEntry = () => {
  const built = buildLocalLedgerEntry(
    {
      occurredOn: "2026-09-04",
      description: "  SSD for field backup  ",
      kind: "expense",
      category: "Equipment & depreciation",
      amount: "$1,234.56",
      shootId: "e-ridgeway",
    },
    { id: "ledger-1", now },
  );
  if (!built.ok) throw new Error(built.error);
  return built.value;
};

const invoiceDraft = () => {
  const built = buildLocalInvoiceDraft(
    {
      clientName: "  Field Notes Co. ",
      clientEmail: "producer@example.com",
      description: " Campaign stills ",
      amount: "850.25",
      dueDate: "2026-09-20",
    },
    { id: "invoice-1", now },
  );
  if (!built.ok) throw new Error(built.error);
  return built.value;
};

describe("local finance money", () => {
  test("stores exact cents and rejects ambiguous formats", () => {
    expect(parseCurrencyToCents("0.01")).toBe(1);
    expect(parseCurrencyToCents("12.30")).toBe(1230);
    expect(parseCurrencyToCents("$1,234.56")).toBe(123456);

    for (const invalid of ["0", "-1", "1e2", "1.234", "1,2", "12,34.00", "NaN"]) {
      expect(parseCurrencyToCents(invalid)).toBeNull();
    }
  });
});

describe("local finance snapshots", () => {
  test("round-trips exact records and preserves unrelated data through mutations", () => {
    const entry = ledgerEntry();
    const invoice = invoiceDraft();
    const initial = upsertLocalInvoiceDraft(
      upsertLocalLedgerEntry(emptyLocalFinanceState(), entry),
      invoice,
    );
    const storage = new MemoryStorage();

    const saved = saveLocalFinanceState(initial, storage, now);
    expect(saved.ok).toBe(true);
    const loaded = loadLocalFinanceState(storage);
    expect(loaded.ok).toBe(true);
    expect(loaded.state.entries).toEqual([entry]);
    expect(loaded.state.invoices).toEqual([invoice]);
    expect(loaded.state.entries[0]?.amountCents).toBe(123456);
    expect(loaded.state.entries[0]?.shootId).toBe("e-ridgeway");
    expect(loaded.state.revision).toBe(1);

    const withoutMissing = deleteLocalLedgerEntry(loaded.state, "not-there");
    expect(withoutMissing).toEqual(loaded.state);
    const withoutInvoice = deleteLocalInvoiceDraft(withoutMissing, invoice.id);
    expect(withoutInvoice.entries).toEqual([entry]);
    expect(withoutInvoice.invoices).toEqual([]);
  });

  test("rejects corrupt, unsupported, partial, and duplicate snapshots without overwriting", () => {
    const valid = {
      ...upsertLocalLedgerEntry(emptyLocalFinanceState(), ledgerEntry()),
      updatedAt: now,
    };
    const snapshots = [
      "{not-json",
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, entries: [{ ...ledgerEntry(), amountCents: 0 }] }),
      JSON.stringify({ ...valid, entries: [ledgerEntry(), ledgerEntry()] }),
      JSON.stringify({ ...valid, invoices: [invoiceDraft(), invoiceDraft()] }),
    ];

    for (const raw of snapshots) {
      const storage = new MemoryStorage(raw);
      const loaded = loadLocalFinanceState(storage);
      expect(loaded.ok).toBe(false);
      expect(storage.value).toBe(raw);
      expect(storage.writes).toBe(0);
    }
  });

  test("reports a failed write without mutating the caller's state", () => {
    const state = upsertLocalLedgerEntry(emptyLocalFinanceState(), ledgerEntry());
    const before = structuredClone(state);
    const storage = new MemoryStorage();
    storage.failWrites = true;

    const saved = saveLocalFinanceState(state, storage, now);
    expect(saved.ok).toBe(false);
    expect(state).toEqual(before);
    expect(storage.value).toBeNull();
  });

  test("rejects a stale writer instead of dropping another tab's changes", () => {
    const storage = new MemoryStorage();
    const initialized = saveLocalFinanceState(emptyLocalFinanceState(), storage, now);
    if (!initialized.ok) throw new Error(initialized.error);

    const tabA = loadLocalFinanceState(storage);
    const tabB = loadLocalFinanceState(storage);
    expect(tabA.ok).toBe(true);
    expect(tabB.ok).toBe(true);

    const entryA = { ...ledgerEntry(), id: "ledger-a", description: "tab A" };
    const entryB = { ...ledgerEntry(), id: "ledger-b", description: "tab B" };
    const savedA = saveLocalFinanceState(upsertLocalLedgerEntry(tabA.state, entryA), storage, now);
    expect(savedA.ok).toBe(true);

    const savedB = saveLocalFinanceState(upsertLocalLedgerEntry(tabB.state, entryB), storage, now);
    expect(savedB.ok).toBe(false);
    if (savedB.ok) throw new Error("Expected a stale-writer conflict");
    expect(savedB.reason).toBe("conflict");
    expect(savedB.currentState?.entries.map((entry) => entry.id)).toEqual(["ledger-a"]);

    const final = loadLocalFinanceState(storage);
    expect(final.state.entries.map((entry) => entry.id)).toEqual(["ledger-a"]);
  });

  test("preserves a snapshot that becomes corrupt after the page loads", () => {
    const storage = new MemoryStorage();
    const seeded = saveLocalFinanceState(
      upsertLocalLedgerEntry(emptyLocalFinanceState(), ledgerEntry()),
      storage,
      now,
    );
    if (!seeded.ok) throw new Error(seeded.error);
    const loaded = loadLocalFinanceState(storage);
    expect(loaded.ok).toBe(true);

    storage.value = "{newly-corrupt";
    storage.writes = 0;
    const attempted = saveLocalFinanceState(
      upsertLocalInvoiceDraft(loaded.state, invoiceDraft()),
      storage,
      now,
    );

    expect(attempted.ok).toBe(false);
    if (attempted.ok) throw new Error("Expected corrupt storage to block the write");
    expect(attempted.reason).toBe("invalid");
    expect(storage.value).toBe("{newly-corrupt");
    expect(storage.writes).toBe(0);
  });
});

describe("local invoice safety", () => {
  test("optional currency, selected shoot and payer metadata roundtrip without relinking legacy records", () => {
    const old = ledgerEntry();
    const cash = buildLocalLedgerEntry(
      {
        occurredOn: "2026-09-08",
        description: "Cash coverage",
        kind: "income",
        category: "Coverage",
        amount: "1234",
        currency: "JPY",
        shootId: "shoot-chosen",
        clientId: "client-chosen",
        clientName: " Athletics ",
        paymentMethod: "cash",
      },
      { id: "yen-cash", now },
    );
    const draft = buildLocalInvoiceDraft(
      {
        clientName: "Athletics",
        clientEmail: "",
        description: "Upcoming job",
        amount: "1.234",
        currency: "KWD",
        dueDate: "",
        shootId: "shoot-chosen",
      },
      { id: "kwd-draft", now },
    );
    if (!cash.ok || !draft.ok) throw new Error("Expected valid currency records");
    expect(cash.value.amountCents).toBe(1234);
    expect(cash.value.clientName).toBe("Athletics");
    expect(draft.value.amountCents).toBe(1234);
    const storage = new MemoryStorage();
    const saved = saveLocalFinanceState(
      { ...emptyLocalFinanceState(), entries: [old, cash.value], invoices: [draft.value] },
      storage,
      now,
    );
    expect(saved.ok).toBe(true);
    const read = loadLocalFinanceState(storage);
    expect(read.ok).toBe(true);
    expect(read.state.entries[0]).toEqual(old);
    expect(read.state.entries[0]?.currency).toBeUndefined();
    expect(read.state.entries[1]).toEqual(cash.value);
    expect(read.state.invoices[0]?.shootId).toBe("shoot-chosen");
    expect(read.state.invoices[0]?.status).toBe("draft");
  });

  test("malformed new optional fields block saving while old snapshot bytes remain unchanged", () => {
    const storage = new MemoryStorage();
    const saved = saveLocalFinanceState(
      { ...emptyLocalFinanceState(), entries: [ledgerEntry()] },
      storage,
      now,
    );
    if (!saved.ok) throw new Error(saved.error);
    const before = storage.value;
    for (const patch of [
      { currency: "ZZZ" },
      { paymentMethod: "card-invented" },
      { clientName: 123 },
    ]) {
      const next = {
        ...saved.state,
        entries: [{ ...saved.state.entries[0]!, ...patch }],
      } as typeof saved.state;
      expect(saveLocalFinanceState(next, storage, now).ok).toBe(false);
      expect(storage.value).toBe(before);
    }
    expect(
      buildLocalLedgerEntry({
        occurredOn: "2026-09-08",
        description: "Work",
        kind: "income",
        category: "Other",
        amount: "1.23",
        currency: "JPY",
        shootId: null,
      }).ok,
    ).toBe(false);
  });

  test("preserves explicit CRM identities while accepting untouched legacy drafts", () => {
    const draft = invoiceDraft();
    const crmDraft = buildLocalInvoiceDraft(
      {
        clientId: "client-exact-id",
        clientName: draft.clientName,
        clientEmail: draft.clientEmail ?? "",
        description: draft.description,
        amount: "850.25",
        dueDate: draft.dueDate ?? "",
      },
      { id: "crm-invoice", now },
    );
    if (!crmDraft.ok) throw new Error(crmDraft.error);
    expect(crmDraft.value.clientId).toBe("client-exact-id");
    const { clientId: _omitted, ...legacyDraft } = draft;
    const storage = new MemoryStorage(
      JSON.stringify({ ...emptyLocalFinanceState(), invoices: [legacyDraft], updatedAt: now }),
    );
    const read = loadLocalFinanceState(storage);
    expect(read.ok).toBe(true);
    expect(read.state.invoices[0]?.clientId).toBeUndefined();
    expect(storage.writes).toBe(0);
  });

  test("creates a draft only and does not synthesize payment or delivery state", () => {
    const invoice = invoiceDraft();
    const serialized = JSON.stringify(invoice);

    expect(invoice.status).toBe("draft");
    expect(invoice.amountCents).toBe(85025);
    expect(serialized).not.toContain("paid");
    expect(serialized).not.toContain("sent");
    expect(serialized).not.toContain("stripe");
    expect(serialized).not.toContain("hosted");
  });
});
