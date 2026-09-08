import {
  bookkeepingTotals,
  entriesForYear,
  ledgerExport,
  categoryExport,
} from "@/lib/bookkeeping-export";
import { localDate } from "@/lib/business/reminders";
import "@/components/lensos/business-workspace.css";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { SEED_EVENTS } from "@/lib/lensos";
import { InvoicePanel } from "@/components/lensos/InvoicePanel";
import {
  addTransaction,
  deleteTransaction,
  disconnectStripe,
  getProfile,
  listTransactions,
  startStripeConnect,
  syncStripe,
} from "@/lib/finance.functions";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import {
  CLIENT_WORKSPACE_KEY,
  invoiceClientKey,
  invoiceClientOptions,
  loadClientWorkspace,
  type WorkspaceClient,
} from "@/lib/client-workspace";
import {
  buildLocalInvoiceDraft,
  buildLocalLedgerEntry,
  commitLocalFinanceState,
  deleteLocalInvoiceDraft,
  deleteLocalLedgerEntry,
  emptyLocalFinanceState,
  loadLocalFinanceState,
  parseCurrencyToCents,
  upsertLocalInvoiceDraft,
  upsertLocalLedgerEntry,
  type LocalFinanceState,
  type LocalInvoiceDraft,
  type LocalLedgerEntry,
} from "@/lib/local-finance-store";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: [
      { title: "Earnings — LensLabs" },
      {
        name: "description",
        content:
          "Recorded income, expenses, invoice drafts, and bookkeeping exports for your photography business.",
      },
      { property: "og:title", content: "Earnings — LensLabs" },
      {
        property: "og:description",
        content: "Keep income and expense records organized by calendar year.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Earnings,
});

type Kind = "income" | "expense";

interface Entry {
  id: string;
  date: string;
  label: string;
  kind: Kind;
  category: string;
  amount: number;
  eventId: string | null;
  source: "manual" | "imported" | "delivery";
}

const EXPENSE_CATEGORIES = [
  "Advertising",
  "Car & mileage",
  "Contract labor (second shooter)",
  "Equipment",
  "Insurance",
  "Legal & professional",
  "Office & supplies",
  "Rent (studio)",
  "Software & subscriptions",
  "Travel",
  "Meals",
  "Other",
];

const INCOME_CATEGORIES = [
  "Event coverage",
  "Licensing",
  "Print sales",
  "Retainer",
  "Other income",
];

type TxRow = {
  id: string;
  occurred_on: string;
  description: string;
  kind: Kind;
  category: string;
  amount: number | string;
  shoot_id: string | null;
  source: string;
};

const toEntry = (t: TxRow): Entry => ({
  id: t.id,
  date: t.occurred_on,
  label: t.description,
  kind: t.kind,
  category: t.category,
  amount: Number(t.amount),
  eventId: t.shoot_id,
  source: (t.source === "manual" ? "manual" : "imported") as Entry["source"],
});

const localToEntry = (entry: LocalLedgerEntry): Entry => ({
  id: entry.id,
  date: entry.occurredOn,
  label: entry.description,
  kind: entry.kind,
  category: entry.category,
  amount: entry.amountCents / 100,
  eventId: entry.shootId,
  source: entry.source,
});

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const sumMoney = (amounts: number[]) =>
  amounts.reduce((totalCents, amount) => totalCents + Math.round(amount * 100), 0) / 100;

const DEMO_EVENT_IDS = new Set(SEED_EVENTS.map((event) => event.id));

function Earnings() {
  const { events: allEvents, clients } = useLens();

  const [runtimeMode, setRuntimeMode] = useState<"checking" | "local" | "remote">("checking");
  const events = useMemo(
    () => allEvents.filter((event) => !DEMO_EVENT_IDS.has(event.id)),
    [allEvents],
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [stripeAccount, setStripeAccount] = useState<string | null>(null);
  const [stripeBusy, setStripeBusy] = useState<string | null>(null);
  const [stripeNote, setStripeNote] = useState<string | null>(null);
  const [localFinance, setLocalFinance] = useState<LocalFinanceState>(() =>
    emptyLocalFinanceState(),
  );
  const [localFinanceWritable, setLocalFinanceWritable] = useState(true);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [confirmDeleteEntryId, setConfirmDeleteEntryId] = useState<string | null>(null);
  const [invoiceDrafts, setInvoiceDrafts] = useState<LocalInvoiceDraft[]>([]);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [confirmDeleteInvoiceId, setConfirmDeleteInvoiceId] = useState<string | null>(null);
  const [invoiceNote, setInvoiceNote] = useState<string | null>(null);
  const [localClientForm, setLocalClientForm] = useState({ name: "", email: "" });
  const [workspaceClients, setWorkspaceClients] = useState<WorkspaceClient[]>([]);
  const [invoiceForm, setInvoiceForm] = useState({
    clientId: null as string | null,
    clientName: "",
    clientEmail: "",
    description: "",
    amount: "",
    dueDate: "",
  });

  const reload = async () => {
    const rows = (await listTransactions()) as unknown as TxRow[];
    setEntries(rows.map(toEntry));
  };

  useEffect(() => {
    if (isLocalSingleUserMode) {
      const loaded = loadLocalFinanceState();
      setRuntimeMode("local");
      setLocalFinance(loaded.state);
      setEntries(loaded.state.entries.map(localToEntry));
      setInvoiceDrafts(loaded.state.invoices);
      setLocalFinanceWritable(loaded.ok);
      setDataError(loaded.warning);
      setLoading(false);
      return;
    }

    setRuntimeMode("remote");
    void (async () => {
      try {
        const [profile] = await Promise.all([getProfile(), reload()]);
        setStripeAccount(profile?.stripe_account_id ?? null);
      } catch {
        setDataError("Sign in to load your live ledger.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (runtimeMode !== "local") return;
    const readContacts = () => {
      const loaded = loadClientWorkspace();
      if (loaded.ok) setWorkspaceClients(loaded.state.clients);
      else
        setInvoiceNote(
          "CRM contacts could not be read. Existing invoice contacts remain available; saved client data was not changed.",
        );
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CLIENT_WORKSPACE_KEY || event.key === null) readContacts();
    };
    readContacts();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", readContacts);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", readContacts);
    };
  }, [runtimeMode]);

  const commitLocalFinance = async (next: LocalFinanceState): Promise<boolean> => {
    if (runtimeMode !== "local") return false;
    if (!localFinanceWritable) {
      setDataError("Editing is paused so the existing local finance data is not overwritten.");
      return false;
    }

    const saved = await commitLocalFinanceState(next);
    if (!saved.ok) {
      if (saved.reason === "conflict" && saved.currentState) {
        setLocalFinance(saved.currentState);
        setEntries(saved.currentState.entries.map(localToEntry));
        setInvoiceDrafts(saved.currentState.invoices);
      } else if (saved.reason === "invalid") {
        setLocalFinanceWritable(false);
      }
      setDataError(saved.error);
      return false;
    }

    setLocalFinance(saved.state);
    setEntries(saved.state.entries.map(localToEntry));
    setInvoiceDrafts(saved.state.invoices);
    setDataError(null);
    return true;
  };

  const connectStripe = async () => {
    if (runtimeMode !== "remote") {
      setStripeNote("Stripe is unavailable in local-personal mode. No connection was attempted.");
      return;
    }
    setStripeBusy("connect");
    const res = await startStripeConnect();
    setStripeBusy(null);
    if (res?.error) return setStripeNote(res.error);
    if (!res?.url) return setStripeNote("Stripe did not return a connection link.");
    window.location.href = res.url;
  };

  const runSync = async () => {
    if (runtimeMode !== "remote") {
      setStripeNote("Stripe sync is unavailable in local-personal mode. Nothing was imported.");
      return;
    }
    setStripeBusy("sync");
    const res = await syncStripe();
    setStripeBusy(null);
    if (res?.error) return setStripeNote(res.error);
    setStripeNote(`Imported ${res.imported} Stripe payments.`);
    await reload();
  };

  const [kind, setKind] = useState<Kind>("expense");
  const [form, setForm] = useState({
    date: "",
    label: "",
    category: EXPENSE_CATEGORIES[0]!,
    amount: "",
    eventId: "",
  });

  const [selectedYear, setSelectedYear] = useState("all");
  const years = [
    ...new Set([String(new Date().getFullYear()), ...entries.map((e) => e.date.slice(0, 4))]),
  ]
    .sort()
    .reverse();
  const periodEntries = useMemo(
    () => entriesForYear(entries, selectedYear),
    [entries, selectedYear],
  );
  const totals = useMemo(() => bookkeepingTotals(periodEntries), [periodEntries]);
  const canExport = !loading && !dataError && periodEntries.length > 0;

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    periodEntries
      .filter((e) => e.kind === "expense")
      .forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + Math.round(e.amount * 100)));
    return [...map.entries()]
      .map(([category, amountCents]) => [category, amountCents / 100] as const)
      .sort((a, b) => b[1] - a[1]);
  }, [periodEntries]);

  /* ---------- real shoot data wired into the ledger ---------- */
  const jobs = useMemo(
    () =>
      events.map((ev) => {
        const ledgerIncome =
          entries
            .filter((e) => e.eventId === ev.id && e.kind === "income")
            .reduce((cents, e) => cents + Math.round(e.amount * 100), 0) / 100;
        const ledgerExpense =
          entries
            .filter((e) => e.eventId === ev.id && e.kind === "expense")
            .reduce((cents, e) => cents + Math.round(e.amount * 100), 0) / 100;

        const income = ledgerIncome;
        const expense = ledgerExpense;

        const hours = ev.metrics.workMinutes / 60;
        const net = income - expense;
        const perHour = hours > 0 ? net / hours : null;

        const deadline = ev.deadlines[0] ?? null;
        const receipt = ev.receipts[0] ?? null;
        const turnaround = receipt
          ? { state: "delivered" as const, at: receipt.at }
          : ev.status === "draft"
            ? { state: "not shot" as const, at: null }
            : { state: "open" as const, at: null };

        return {
          id: ev.id,
          name: ev.name,
          client: clients.find((c) => c.id === ev.clientId)?.name ?? "—",
          frames: ev.metrics.ingested,
          keepers: ev.pickQueue.selects,
          hours,
          income,
          expense,
          net,
          perHour,
          deadline,
          turnaround,
        };
      }),
    [events, entries, clients],
  );

  const shootTotals = useMemo(() => {
    const hours = jobs.reduce((s, j) => s + j.hours, 0);
    const net = sumMoney(jobs.map((job) => job.net));
    const frames = jobs.reduce((s, j) => s + j.frames, 0);
    return { hours, net, frames, perHour: hours > 0 ? net / hours : 0 };
  }, [jobs]);

  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const add = async () => {
    const amountCents = parseCurrencyToCents(form.amount);
    if (!form.label.trim()) return setDataError("Add a description.");
    if (amountCents === null) {
      return setDataError("Enter a positive amount with up to two decimals.");
    }

    const occurredOn = form.date || localDate();
    if (runtimeMode === "local") {
      const existing = editingEntryId
        ? localFinance.entries.find((entry) => entry.id === editingEntryId)
        : null;
      if (editingEntryId && !existing) {
        setDataError("That local ledger entry no longer exists. Nothing was changed.");
        return;
      }

      const built = buildLocalLedgerEntry(
        {
          kind,
          category: form.category,
          description: form.label,
          amount: form.amount,
          occurredOn,
          shootId: form.eventId || null,
        },
        existing ? { id: existing.id, createdAt: existing.createdAt } : {},
      );
      if (!built.ok) return setDataError(built.error);
      if (!(await commitLocalFinance(upsertLocalLedgerEntry(localFinance, built.value)))) return;

      setEditingEntryId(null);
      setForm((current) => ({ ...current, label: "", amount: "" }));
      return;
    }

    if (runtimeMode !== "remote") return;
    const amount = amountCents / 100;
    const res = await addTransaction({
      data: {
        kind,
        category: form.category,
        description: form.label.trim(),
        amount,
        occurred_on: occurredOn,
        shoot_id: form.eventId && isUuid(form.eventId) ? form.eventId : null,
      },
    });
    if (res?.error) return setDataError(res.error);
    if (!res?.transaction) return setDataError("The transaction was not saved.");
    setEntries((prev) => [toEntry(res.transaction as TxRow), ...prev]);
    setForm({ ...form, label: "", amount: "" });
  };

  const removeEntry = async (id: string) => {
    if (runtimeMode === "local") {
      if (!(await commitLocalFinance(deleteLocalLedgerEntry(localFinance, id)))) return;
      setConfirmDeleteEntryId(null);
      if (editingEntryId === id) {
        setEditingEntryId(null);
        setForm((current) => ({ ...current, label: "", amount: "" }));
      }
      return;
    }

    if (runtimeMode !== "remote") return;
    const res = await deleteTransaction({ data: { id } });
    if (res?.error) return setDataError(res.error);
    setEntries((prev) => prev.filter((x) => x.id !== id));
  };

  const editLocalEntry = (entry: Entry) => {
    if (runtimeMode !== "local") return;
    setKind(entry.kind);
    setForm({
      date: entry.date,
      label: entry.label,
      category: entry.category,
      amount: entry.amount.toFixed(2),
      eventId: entry.eventId ?? "",
    });
    setEditingEntryId(entry.id);
    setConfirmDeleteEntryId(null);
    setDataError(null);
  };

  const cancelEntryEdit = () => {
    setEditingEntryId(null);
    setForm((current) => ({ ...current, label: "", amount: "" }));
  };

  const saveInvoiceDraft = async () => {
    if (runtimeMode !== "local") return;
    const existing = editingInvoiceId
      ? localFinance.invoices.find((invoice) => invoice.id === editingInvoiceId)
      : null;
    if (editingInvoiceId && !existing) {
      setInvoiceNote("That local invoice draft no longer exists. Nothing was changed.");
      return;
    }

    const built = buildLocalInvoiceDraft(
      invoiceForm,
      existing ? { id: existing.id, createdAt: existing.createdAt } : {},
    );
    if (!built.ok) return setInvoiceNote(built.error);
    if (!(await commitLocalFinance(upsertLocalInvoiceDraft(localFinance, built.value)))) return;

    setEditingInvoiceId(null);
    setInvoiceForm({
      clientId: null,
      clientName: "",
      clientEmail: "",
      description: "",
      amount: "",
      dueDate: "",
    });
    setInvoiceNote("Draft saved in this browser. It was not sent and is not marked paid.");
  };

  const editInvoiceDraft = (invoice: LocalInvoiceDraft) => {
    setEditingInvoiceId(invoice.id);
    setInvoiceForm({
      clientId: invoice.clientId ?? null,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail ?? "",
      description: invoice.description,
      amount: (invoice.amountCents / 100).toFixed(2),
      dueDate: invoice.dueDate ?? "",
    });
    setConfirmDeleteInvoiceId(null);
    setInvoiceNote(null);
  };

  const cancelInvoiceEdit = () => {
    setEditingInvoiceId(null);
    setInvoiceForm({
      clientId: null,
      clientName: "",
      clientEmail: "",
      description: "",
      amount: "",
      dueDate: "",
    });
  };

  const removeInvoiceDraft = async (id: string) => {
    if (runtimeMode !== "local") return;
    if (!(await commitLocalFinance(deleteLocalInvoiceDraft(localFinance, id)))) return;
    setConfirmDeleteInvoiceId(null);
    if (editingInvoiceId === id) cancelInvoiceEdit();
    setInvoiceNote("Draft deleted from this browser.");
  };

  const exportRecords = (summary = false) => {
    if (!canExport) return;
    try {
      const csv = summary
        ? categoryExport(entries, selectedYear)
        : ledgerExport(
            entries,
            selectedYear,
            (id) => events.find((event) => event.id === id)?.name ?? "",
          );
      const url = URL.createObjectURL(
        new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lenslabs-${summary ? "category-summary" : "ledger"}-${selectedYear === "all" ? "all-dates" : selectedYear}-USD.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDataError(
        error instanceof Error
          ? error.message
          : "The export could not be created. Your ledger is unchanged.",
      );
    }
  };
  const exportCsv = () => exportRecords();

  const cats = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const selectedInvoiceContact = {
    clientId: invoiceForm.clientId,
    name: invoiceForm.clientName,
    email: invoiceForm.clientEmail,
  };
  const localInvoiceClients = invoiceClientOptions(
    workspaceClients,
    invoiceDrafts,
    selectedInvoiceContact,
  );

  return (
    <Shell hideEventHeader>
      <div className="business-workspace">
        <SectionTitle
          kicker="Business"
          title="Earnings so far"
          sub="Your recorded income and expenses. Invoice drafts are not counted as earnings."
        />

        {dataError && (
          <Card className="mb-4 border-destructive/40">
            <p className="text-sm text-destructive">{dataError}</p>
          </Card>
        )}

        <div className="business-overview-toolbar">
          <label htmlFor="earnings-period">
            Period
            <select
              id="earnings-period"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="all">All dates</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <span>
            USD · {selectedYear === "all" ? "all recorded dates" : `calendar year ${selectedYear}`}
          </span>
          <button
            onClick={() =>
              document.getElementById("tax-records")?.scrollIntoView({ block: "start" })
            }
          >
            Tax records
          </button>
        </div>
        <div className="business-metrics" aria-label="Recorded earnings">
          {[
            ["Income received", money(totals.income), "Recorded income only"],
            ["Expenses", money(totals.expense), "Recorded costs, before tax treatment"],
            ["Net before tax", money(totals.net), "Income minus expenses"],
          ].map(([label, value, note]) => (
            <div key={label}>
              <p>{label}</p>
              <strong>{loading || dataError ? "—" : value}</strong>
              <small>{note}</small>
            </div>
          ))}
        </div>

        {runtimeMode === "local" ? (
          <p className="business-local-note">Saved on this device. Payments are not connected.</p>
        ) : (
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                  Stripe · your own account
                </p>
                <p className="mt-1 text-[13px] text-moss">
                  {stripeAccount
                    ? `Connected — ${stripeAccount}. Charges and paid invoices land in this ledger automatically.`
                    : "Connect your existing Stripe account to import charges and send invoices."}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                {stripeAccount ? (
                  <>
                    <Btn
                      className="px-3 py-1.5 text-[13px]"
                      disabled={stripeBusy === "sync"}
                      onClick={() => void runSync()}
                    >
                      {stripeBusy === "sync" ? "Syncing…" : "Sync payments"}
                    </Btn>
                    <Btn
                      className="px-3 py-1.5 text-[13px]"
                      onClick={() => void disconnectStripe().then(() => setStripeAccount(null))}
                    >
                      Disconnect
                    </Btn>
                  </>
                ) : (
                  <Btn
                    variant="primary"
                    className="px-3 py-1.5 text-[13px]"
                    disabled={runtimeMode !== "remote" || stripeBusy === "connect"}
                    onClick={() => void connectStripe()}
                  >
                    {stripeBusy === "connect" ? "Opening Stripe…" : "Connect Stripe"}
                  </Btn>
                )}
              </div>
            </div>
            {stripeNote && <p className="mt-2 font-mono text-[12px] text-moss">{stripeNote}</p>}
            {loading && <p className="mt-2 font-mono text-[12px] text-moss">loading ledger…</p>}
          </Card>
        )}

        {runtimeMode === "local" && (
          <details className="business-invoices">
            <summary>
              Invoice drafts <span>{invoiceDrafts.length} · not sent</span>
            </summary>
            <Card className="mt-4 p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                  Invoices
                </p>
                <p className="ml-auto font-mono text-[11px] text-moss">local drafts · not sent</p>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-border p-4">
                <select
                  value={invoiceForm.clientName ? invoiceClientKey(selectedInvoiceContact) : ""}
                  onChange={(event) => {
                    const contact = localInvoiceClients.find(
                      ([key]) => key === event.target.value,
                    )?.[1];
                    setInvoiceForm((current) => ({
                      ...current,
                      clientId: contact?.clientId ?? null,
                      clientName: contact?.name ?? "",
                      clientEmail: contact?.email ?? "",
                    }));
                  }}
                  aria-label="Invoice client"
                  className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
                >
                  <option value="">Client…</option>
                  {localInvoiceClients.map(([key, contact]) => (
                    <option key={key} value={key}>
                      {contact.name}
                      {contact.clientId ? " · Clients" : " · saved contact"}
                    </option>
                  ))}
                </select>
                <input
                  value={invoiceForm.description}
                  onChange={(event) =>
                    setInvoiceForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="What for"
                  className="min-w-[160px] flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
                />
                <input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(event) =>
                    setInvoiceForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                  onInput={(event) => {
                    const dueDate = event.currentTarget.value;
                    setInvoiceForm((current) => ({ ...current, dueDate }));
                  }}
                  aria-label="Invoice due date"
                  className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
                />
                <input
                  inputMode="decimal"
                  value={invoiceForm.amount}
                  onChange={(event) =>
                    setInvoiceForm((current) => ({ ...current, amount: event.target.value }))
                  }
                  placeholder="0.00"
                  aria-label="Invoice amount in USD"
                  className="w-24 rounded-lg border border-input bg-card px-3 py-1.5 text-right font-mono text-[13px] outline-none"
                />
                <Btn
                  className="px-3 py-1.5 text-[13px]"
                  disabled={!localFinanceWritable}
                  onClick={() => void saveInvoiceDraft()}
                >
                  {editingInvoiceId ? "Save changes" : "Save draft"}
                </Btn>
                {editingInvoiceId ? (
                  <Btn className="px-3 py-1.5 text-[13px]" onClick={cancelInvoiceEdit}>
                    Cancel
                  </Btn>
                ) : (
                  <Btn variant="primary" className="px-3 py-1.5 text-[13px]" disabled>
                    <span title="Sending invoices requires a connected account.">Send invoice</span>
                  </Btn>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-b border-border p-4">
                <input
                  value={localClientForm.name}
                  onChange={(event) =>
                    setLocalClientForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="New client name"
                  className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
                />
                <input
                  type="email"
                  value={localClientForm.email}
                  onChange={(event) =>
                    setLocalClientForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="client@email.com"
                  className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
                />
                <Btn
                  className="px-3 py-1.5 text-[13px]"
                  disabled={!localFinanceWritable || !localClientForm.name.trim()}
                  onClick={() => {
                    setInvoiceForm((current) => ({
                      ...current,
                      clientId: null,
                      clientName: localClientForm.name.trim(),
                      clientEmail: localClientForm.email.trim(),
                    }));
                    setLocalClientForm({ name: "", email: "" });
                    setInvoiceNote(
                      "Client selected for this draft. Save the draft to keep their details.",
                    );
                  }}
                >
                  Use client
                </Btn>
                {invoiceNote && (
                  <p role="status" className="ml-auto self-center font-mono text-[12px] text-moss">
                    {invoiceNote}
                  </p>
                )}
              </div>

              <div className="max-h-[320px] overflow-y-auto">
                {invoiceDrafts.length === 0 && localFinanceWritable && (
                  <p className="p-4 text-sm text-moss">No invoices yet.</p>
                )}
                {!localFinanceWritable && (
                  <p className="text-sm text-moss">
                    Saved invoice data is still in browser storage, but it cannot be shown safely.
                  </p>
                )}
                {invoiceDrafts.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 last:border-0"
                  >
                    <span className="text-sm font-medium">{invoice.clientName}</span>
                    {invoice.clientEmail && (
                      <span className="text-[12px] text-moss">{invoice.clientEmail}</span>
                    )}
                    <span className="text-[13px] text-moss">{invoice.description}</span>
                    <Chip>draft · not sent</Chip>
                    {invoice.dueDate && (
                      <span className="font-mono text-[11px] text-moss">due {invoice.dueDate}</span>
                    )}
                    <span className="ml-auto font-mono text-[13px]">
                      {money(invoice.amountCents / 100)}
                    </span>
                    <button
                      onClick={() => editInvoiceDraft(invoice)}
                      className="font-mono text-[12px] text-moss hover:text-ink"
                    >
                      edit
                    </button>
                    {confirmDeleteInvoiceId === invoice.id ? (
                      <>
                        <button
                          onClick={() => void removeInvoiceDraft(invoice.id)}
                          className="font-mono text-[12px] text-destructive"
                        >
                          confirm delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteInvoiceId(null)}
                          className="font-mono text-[12px] text-moss hover:text-ink"
                        >
                          cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteInvoiceId(invoice.id)}
                        className="font-mono text-[12px] text-moss hover:text-destructive"
                      >
                        delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </details>
        )}

        {runtimeMode === "remote" && <InvoicePanel />}

        {jobs.length > 0 && (
          <Card className="mt-4 p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Project activity · all dates
              </p>
              <p className="ml-auto font-mono text-[11px] text-moss">
                {shootTotals.frames.toLocaleString()} frames · {shootTotals.hours.toFixed(1)} h ·{" "}
                <span className="text-ink">{money(shootTotals.perHour)}/h</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    <th className="p-3 text-left">Shoot</th>
                    <th className="p-3 text-right">Frames</th>
                    <th className="p-3 text-right">Keepers</th>
                    <th className="p-3 text-right">Hours</th>
                    <th className="p-3 text-right">Income</th>
                    <th className="p-3 text-right">Costs</th>
                    <th className="p-3 text-right">Profit / hr</th>
                    <th className="p-3 text-left">Turnaround</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b border-border last:border-0">
                      <td className="p-3">
                        <p className="font-medium">{j.name}</p>
                        <p className="font-mono text-[10px] text-moss">{j.client}</p>
                      </td>
                      <td className="p-3 text-right font-mono">{j.frames.toLocaleString()}</td>
                      <td className="p-3 text-right font-mono">{j.keepers}</td>
                      <td className="p-3 text-right font-mono">{j.hours.toFixed(1)}</td>
                      <td className="p-3 text-right font-mono">{money(j.income)}</td>
                      <td className="p-3 text-right font-mono">{money(j.expense)}</td>
                      <td className={`p-3 text-right font-mono ${j.net < 0 ? "text-rust" : ""}`}>
                        {j.perHour === null ? "—" : `${money(j.perHour)}/h`}
                      </td>
                      <td className="p-3">
                        <p className="font-mono text-[11px]">
                          {j.turnaround.state === "delivered"
                            ? `delivered ${j.turnaround.at}`
                            : j.turnaround.state === "not shot"
                              ? "not shot yet"
                              : "in progress"}
                        </p>
                        <p className="font-mono text-[10px] text-moss">
                          {j.deadline
                            ? `due ${j.deadline.at} · ${j.deadline.label}`
                            : "no deadline set"}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Ledger</p>
              <Btn
                className="ml-auto px-3 py-1.5 text-[13px]"
                onClick={exportCsv}
                disabled={!canExport}
              >
                Export CSV
              </Btn>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border p-4">
              <div className="flex overflow-hidden rounded-lg border border-input">
                {(["expense", "income"] as Kind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      setKind(k);
                      setForm((current) => ({
                        ...current,
                        category: (k === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]!,
                      }));
                    }}
                    className={`px-3 py-1.5 text-[13px] ${kind === k ? "bg-ink text-paper2" : "text-moss"}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <input
                type="date"
                aria-label="Ledger date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
              />
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Description"
                aria-label="Ledger description"
                className="min-w-[160px] flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
              />
              <select
                aria-label="Ledger category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
              >
                {(!cats.includes(form.category) ? [form.category, ...cats] : cats).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select
                aria-label="Ledger project"
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
              >
                <option value="">No event</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                inputMode="decimal"
                aria-label="Ledger amount in USD"
                className="w-24 rounded-lg border border-input bg-card px-3 py-1.5 text-right font-mono text-[13px] outline-none"
              />
              <Btn
                variant="primary"
                className="px-3 py-1.5 text-[13px]"
                disabled={
                  runtimeMode === "checking" || (runtimeMode === "local" && !localFinanceWritable)
                }
                onClick={() => void add()}
              >
                {editingEntryId ? "Save" : "Add"}
              </Btn>
              {editingEntryId && (
                <Btn className="px-3 py-1.5 text-[13px]" onClick={cancelEntryEdit}>
                  Cancel
                </Btn>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {periodEntries.length === 0 && !loading && localFinanceWritable && (
                <p className="p-4 text-sm text-moss">No ledger entries in this period.</p>
              )}
              {runtimeMode === "local" && !localFinanceWritable && (
                <p className="text-sm text-moss">
                  Saved ledger data is still in browser storage, but it cannot be shown safely.
                </p>
              )}
              {periodEntries.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <span className="font-mono text-[11px] text-moss">{e.date}</span>
                  <span className="text-sm">{e.label}</span>
                  <Chip>{e.category}</Chip>
                  {e.eventId && (
                    <span className="text-[12px] text-moss">
                      {events.find((v) => v.id === e.eventId)?.name}
                    </span>
                  )}
                  <span
                    className={`ml-auto font-mono text-[13px] ${e.kind === "income" ? "text-rust" : ""}`}
                  >
                    {e.kind === "income" ? "+" : "−"}
                    {money(e.amount)}
                  </span>
                  {runtimeMode === "local" && (
                    <button
                      onClick={() => editLocalEntry(e)}
                      className="font-mono text-[12px] text-moss hover:text-ink"
                    >
                      edit
                    </button>
                  )}
                  {runtimeMode === "local" && confirmDeleteEntryId === e.id ? (
                    <>
                      <button
                        onClick={() => void removeEntry(e.id)}
                        className="font-mono text-[12px] text-destructive"
                      >
                        confirm delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteEntryId(null)}
                        className="font-mono text-[12px] text-moss hover:text-ink"
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() =>
                        runtimeMode === "local"
                          ? setConfirmDeleteEntryId(e.id)
                          : void removeEntry(e.id)
                      }
                      className="text-[12px] text-moss hover:text-ink"
                      aria-label={runtimeMode === "local" ? `Delete ${e.label}` : undefined}
                    >
                      {runtimeMode === "local" ? "delete" : "✕"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Expense categories · recorded amounts
              </p>
              <div className="mt-3 space-y-2">
                {byCategory.map(([c, v]) => (
                  <div key={c}>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-moss">{c}</span>
                      <span className="font-mono">{money(v)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-muted">
                      <div
                        className="h-1 rounded-full bg-ink"
                        style={{ width: `${(v / (byCategory[0]?.[1] ?? 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                {byCategory.length === 0 && (
                  <p className="text-sm text-moss">No expenses logged.</p>
                )}
              </div>
            </Card>

            <section
              id="tax-records"
              className="business-tax-records"
              aria-labelledby="tax-records-title"
            >
              <h2 id="tax-records-title">Tax records</h2>
              <p>
                Export your ledger and category totals for your accountant. All amounts are USD;
                expenses are exported in full without assuming deductibility.
              </p>
              <div className="business-export-actions">
                <Btn variant="primary" disabled={!canExport} onClick={exportCsv}>
                  Download ledger CSV
                </Btn>
                <Btn disabled={!canExport} onClick={() => exportRecords(true)}>
                  Download category summary
                </Btn>
              </div>
              <p className="business-export-note">
                {periodEntries.length} record{periodEntries.length === 1 ? "" : "s"} ·{" "}
                {selectedYear === "all" ? "All dates" : selectedYear} · USD
              </p>
              <p>
                This prepares records, not a tax return. Keep the supporting receipts.
                Country-specific tax calculations and filing are not enabled.
              </p>
            </section>
          </div>
        </div>
      </div>
    </Shell>
  );
}
