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
      { title: "Earnings & Tax — LensLabs" },
      {
        name: "description",
        content:
          "Every photography earning and loss in one ledger, grouped into Schedule C expense categories and exportable as a tax-ready CSV or summary.",
      },
      { property: "og:title", content: "Earnings & Tax — LensLabs" },
      {
        property: "og:description",
        content:
          "Income, deductible expenses, mileage, quarterly estimates and a tax-ready export.",
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
  "Equipment & depreciation",
  "Insurance",
  "Legal & professional",
  "Office & supplies",
  "Rent (studio)",
  "Software & subscriptions",
  "Travel",
  "Meals (50%)",
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

/** Ledger categories mapped to the Schedule C line they belong on. */
const SCHEDULE_C_LINE: Record<string, { line: string; label: string }> = {
  Advertising: { line: "8", label: "Advertising" },
  "Car & mileage": { line: "9", label: "Car and truck expenses" },
  "Contract labor (second shooter)": { line: "11", label: "Contract labor" },
  "Equipment & depreciation": { line: "13", label: "Depreciation and section 179" },
  Insurance: { line: "15", label: "Insurance (other than health)" },
  "Legal & professional": { line: "17", label: "Legal and professional services" },
  "Office & supplies": { line: "18", label: "Office expense" },
  "Rent (studio)": { line: "20.2", label: "Rent — other business property (20b)" },
  Travel: { line: "24.1", label: "Travel (24a)" },
  "Meals (50%)": { line: "24.2", label: "Deductible meals — 50% (24b)" },
  "Software & subscriptions": { line: "27.1", label: "Other expenses (27a) — software" },
  Other: { line: "27.2", label: "Other expenses (27a)" },
};

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const sumMoney = (amounts: number[]) =>
  amounts.reduce((totalCents, amount) => totalCents + Math.round(amount * 100), 0) / 100;

const DEMO_EVENT_IDS = new Set(SEED_EVENTS.map((event) => event.id));

function Earnings() {
  const { events: allEvents, clients } = useLens();

  const [runtimeMode, setRuntimeMode] = useState<"checking" | "local" | "remote">("checking");
  const events = useMemo(
    () =>
      runtimeMode === "remote"
        ? allEvents
        : allEvents.filter((event) => !DEMO_EVENT_IDS.has(event.id)),
    [allEvents, runtimeMode],
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

  const totals = useMemo(() => {
    const income = sumMoney(entries.filter((e) => e.kind === "income").map((e) => e.amount));
    const expense = sumMoney(entries.filter((e) => e.kind === "expense").map((e) => e.amount));
    return { income, expense, net: income - expense };
  }, [entries]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    entries
      .filter((e) => e.kind === "expense")
      .forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + Math.round(e.amount * 100)));
    return [...map.entries()]
      .map(([category, amountCents]) => [category, amountCents / 100] as const)
      .sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const scheduleC = useMemo(() => {
    const rows = new Map<string, { line: string; label: string; amount: number }>();
    for (const [cat, amount] of byCategory) {
      const map = SCHEDULE_C_LINE[cat] ?? SCHEDULE_C_LINE["Other"]!;
      const deductible = cat === "Meals (50%)" ? amount * 0.5 : amount;
      const prev = rows.get(map.line);
      rows.set(map.line, {
        line: map.line,
        label: map.label,
        amount: (prev?.amount ?? 0) + deductible,
      });
    }
    return [...rows.values()].sort((a, b) => parseFloat(a.line) - parseFloat(b.line));
  }, [byCategory]);

  const payerName = (eventId: string | null) => {
    const ev = events.find((v) => v.id === eventId);
    const client = clients.find((c) => c.id === ev?.clientId);
    return client?.org || client?.name || ev?.name || "Direct / unassigned";
  };

  const payers = useMemo(() => {
    const map = new Map<string, number>();
    entries
      .filter((e) => e.kind === "income")
      .forEach((e) => {
        const name = payerName(e.eventId);
        map.set(name, (map.get(name) ?? 0) + Math.round(e.amount * 100));
      });
    return [...map.entries()]
      .map(([name, totalCents]) => ({ name, total: totalCents / 100 }))
      .sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, events, clients]);

  const payees = useMemo(() => {
    const map = new Map<string, number>();
    entries
      .filter((e) => e.kind === "expense" && e.category.startsWith("Contract labor"))
      .forEach((e) => {
        const name = e.label.split("—").slice(-1)[0]!.trim() || e.label;
        map.set(name, (map.get(name) ?? 0) + Math.round(e.amount * 100));
      });
    return [...map.entries()]
      .map(([name, totalCents]) => ({ name, total: totalCents / 100 }))
      .sort((a, b) => b.total - a.total);
  }, [entries]);

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

        const income =
          runtimeMode === "local"
            ? ledgerIncome
            : ledgerIncome ||
              ev.money.collected ||
              ev.money.invoiced ||
              ev.money.agreedRevenue ||
              0;
        const expense =
          runtimeMode === "local"
            ? ledgerExpense
            : ledgerExpense || ev.money.actualCosts || ev.money.estimatedCosts || 0;

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
    [events, entries, clients, runtimeMode],
  );

  const shootTotals = useMemo(() => {
    const hours = jobs.reduce((s, j) => s + j.hours, 0);
    const net = sumMoney(jobs.map((job) => job.net));
    const frames = jobs.reduce((s, j) => s + j.frames, 0);
    return { hours, net, frames, perHour: hours > 0 ? net / hours : 0 };
  }, [jobs]);

  const selfEmployment = Math.max(0, totals.net) * 0.9235 * 0.153;
  const quarterly = (selfEmployment + Math.max(0, totals.net) * 0.15) / 4;

  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const add = async () => {
    const amountCents = parseCurrencyToCents(form.amount);
    if (!form.label.trim()) return setDataError("Add a description.");
    if (amountCents === null) {
      return setDataError("Enter a positive amount with up to two decimals.");
    }

    const occurredOn = form.date || new Date().toISOString().slice(0, 10);
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

  const exportCsv = () => {
    const rows = [
      ["date", "type", "category", "description", "event", "amount_usd", "source"],
      ...entries.map((e) => [
        e.date,
        e.kind,
        e.category,
        e.label.replace(/,/g, ";"),
        events.find((v) => v.id === e.eventId)?.name.replace(/,/g, ";") ?? "",
        e.amount.toFixed(2),
        e.source,
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `lensos-tax-ledger-${new Date().getFullYear()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download = (name: string, rows: (string | number)[][]) => {
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportScheduleC = () =>
    download(`lensos-schedule-c-${new Date().getFullYear()}.csv`, [
      ["line", "description", "amount_usd"],
      ["1", "Gross receipts or sales", totals.income.toFixed(2)],
      ["7", "Gross income", totals.income.toFixed(2)],
      ...scheduleC.map((r) => [
        r.line.replace(".1", "a").replace(".2", "b"),
        r.label.replace(/,/g, ";"),
        r.amount.toFixed(2),
      ]),
      ["28", "Total expenses", totals.expense.toFixed(2)],
      ["31", "Net profit or (loss)", totals.net.toFixed(2)],
    ]);

  const export1099 = () =>
    download(`lensos-1099-${new Date().getFullYear()}.csv`, [
      ["direction", "party", "amount_usd", "threshold_600"],
      ...payers.map((p) => [
        "income received",
        p.name.replace(/,/g, ";"),
        p.total.toFixed(2),
        p.total >= 600 ? "yes" : "no",
      ]),
      ...payees.map((p) => [
        "contractor paid",
        p.name.replace(/,/g, ";"),
        p.total.toFixed(2),
        p.total >= 600 ? "yes" : "no",
      ]),
    ]);

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
      <SectionTitle
        kicker="Earnings"
        title="Every dollar in, every dollar out — tax-ready."
        sub="Grouped into Schedule C categories. Nothing is estimated for you unless it is labelled an estimate."
      />

      {dataError && (
        <Card className="mb-4 border-destructive/40">
          <p className="text-sm text-destructive">{dataError}</p>
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Stripe · your own account
            </p>
            <p className="mt-1 text-[13px] text-moss">
              {runtimeMode === "local"
                ? "Local ledger and invoice drafts stay in this browser. Stripe is disconnected."
                : stripeAccount
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

      {runtimeMode === "local" && (
        <Card className="mt-4 p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Invoices</p>
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
      )}

      {runtimeMode === "remote" && <InvoicePanel />}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Income", money(totals.income), "gross receipts"],
          ["Expenses", money(totals.expense), "deductible business costs"],
          ["Net profit", money(totals.net), "income − expenses"],
        ].map(([k, v, s]) => (
          <Card key={k}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-moss">{k}</p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-tight">{v}</p>
            <p className="text-[13px] text-moss">{s}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
            Per shoot — live from your jobs
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Ledger</p>
            <Btn className="ml-auto px-3 py-1.5 text-[13px]" onClick={exportCsv}>
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
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
            />
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Description"
              className="min-w-[160px] flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
            >
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
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
            {entries.length === 0 && !loading && localFinanceWritable && (
              <p className="p-4 text-sm text-moss">No ledger entries yet.</p>
            )}
            {runtimeMode === "local" && !localFinanceWritable && (
              <p className="text-sm text-moss">
                Saved ledger data is still in browser storage, but it cannot be shown safely.
              </p>
            )}
            {entries.map((e) => (
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
              Schedule C · expense categories
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
              {byCategory.length === 0 && <p className="text-sm text-moss">No expenses logged.</p>}
            </div>
          </Card>

          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Tax export
            </p>
            <div className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-moss">Schedule C line 1 · gross receipts</span>
                <span className="font-mono">{money(totals.income)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-moss">Schedule C line 28 · total expenses</span>
                <span className="font-mono">{money(totals.expense)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-moss">Schedule C line 31 · net profit</span>
                <span className="font-mono">{money(totals.net)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-moss">Est. self-employment tax (15.3%)</span>
                <span className="font-mono">{money(selfEmployment)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-moss">Est. quarterly set-aside</span>
                <span className="font-mono">{money(quarterly)}</span>
              </div>
            </div>
            <Btn variant="primary" className="mt-4" onClick={exportCsv}>
              Download tax-ready ledger
            </Btn>
            <p className="mt-3 text-[12px] text-moss">
              Estimates use standard US self-employment rates and are guidance, not filed advice.
              The CSV imports into TurboTax, FreeTaxUSA or your accountant's spreadsheet as-is.
            </p>
          </Card>
        </div>
      </div>

      {/* ---------------- tax forms ---------------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Form 1040 · Schedule C (Profit or Loss From Business)
            </p>
            <Btn className="ml-auto px-3 py-1.5 text-[13px]" onClick={exportScheduleC}>
              Export Schedule C CSV
            </Btn>
          </div>
          <div className="p-4">
            <div className="flex justify-between border-b border-border pb-2 text-[13px]">
              <span className="text-moss">Line 1 · Gross receipts or sales</span>
              <span className="font-mono">{money(totals.income)}</span>
            </div>
            <div className="flex justify-between border-b border-border py-2 text-[13px]">
              <span className="text-moss">Line 7 · Gross income</span>
              <span className="font-mono">{money(totals.income)}</span>
            </div>
            <p className="pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
              Part II · Expenses
            </p>
            {scheduleC.map((row) => (
              <div
                key={row.line}
                className="flex justify-between border-b border-border py-1.5 text-[13px]"
              >
                <span className="text-moss">
                  Line {row.line} · {row.label}
                </span>
                <span className="font-mono">{money(row.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between py-2 text-[13px] font-semibold">
              <span>Line 28 · Total expenses</span>
              <span className="font-mono">{money(totals.expense)}</span>
            </div>
            <div className="flex justify-between text-[13px] font-semibold">
              <span>Line 31 · Net profit or (loss)</span>
              <span className="font-mono">{money(totals.net)}</span>
            </div>
            <p className="mt-3 text-[12px] text-moss">
              Lines shown carry a balance. Meals are reported at the 50% deductible amount on line
              24b. This is your ledger mapped to the form — not filed advice.
            </p>
          </div>
        </Card>

        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Form 1099-NEC · payers and payees
            </p>
            <Btn className="ml-auto px-3 py-1.5 text-[13px]" onClick={export1099}>
              Export 1099 CSV
            </Btn>
          </div>
          <div className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
              Income you should receive a 1099-NEC for
            </p>
            {payers.length === 0 && <p className="mt-2 text-sm text-moss">No income logged.</p>}
            {payers.map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between border-b border-border py-2 text-[13px]"
              >
                <span>{p.name}</span>
                <span className="flex items-center gap-2">
                  <Chip tone={p.total >= 600 ? "solid" : "quiet"}>
                    {p.total >= 600 ? "1099 expected" : "under $600"}
                  </Chip>
                  <span className="font-mono">{money(p.total)}</span>
                </span>
              </div>
            ))}

            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
              Contractors you must issue a 1099-NEC to (box 1)
            </p>
            {payees.length === 0 && (
              <p className="mt-2 text-sm text-moss">No contract labor logged.</p>
            )}
            {payees.map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between border-b border-border py-2 text-[13px]"
              >
                <span>{p.name}</span>
                <span className="flex items-center gap-2">
                  <Chip tone={p.total >= 600 ? "warn" : "quiet"}>
                    {p.total >= 600 ? "file by Jan 31" : "under $600"}
                  </Chip>
                  <span className="font-mono">{money(p.total)}</span>
                </span>
              </div>
            ))}
            <p className="mt-3 text-[12px] text-moss">
              The $600 threshold is per payer for the calendar year. Collect a W-9 from every
              contractor before you pay them.
            </p>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
