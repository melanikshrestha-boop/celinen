import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, FileText, RefreshCw, Search } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useWorkbench } from "@/components/workbench/context";
import { Shell } from "@/components/lensos/Shell";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  useShootNavigationData,
  shootWorkspaceHref,
  parseShootKey,
} from "@/components/shoots/navigation";
import {
  buildEarningsLedger,
  filterEarningsRows,
  earningsCsv,
  summarizeEarnings,
  type EarningsFilter,
  type EarningsInvoice,
  type EarningsRow,
} from "@/lib/earnings-ledger";
import { readRevenueGoal, writeRevenueGoal } from "@/lib/revenue-goal";
import {
  addTransaction,
  saveClient,
  startStripeConnect,
  saveInvoiceDraft,
  sendInvoice,
} from "@/lib/finance.functions";
import { localDate } from "@/lib/business/reminders";
import {
  buildLocalInvoiceDraft,
  buildLocalLedgerEntry,
  commitLocalFinanceState,
  upsertLocalInvoiceDraft,
  upsertLocalLedgerEntry,
  type LocalFinanceState,
} from "@/lib/local-finance-store";
import { decimalToMinorUnits, minorUnitsDecimal, parseFinanceAmount } from "@/lib/finance-money";
import { useEarningsData, earningsChanged } from "./useEarningsData";
import { buildEarningsCharts } from "@/lib/earnings-charts";
import { EarningsCharts } from "./EarningsCharts";
import { buildPhotographerBooks } from "@/lib/photographer-books";
import { BooksDashboard } from "./BooksDashboard";
import { CustomerReceipt } from "./CustomerReceipt";
import { FinanceOs, readFinanceDesk, type FinanceDesk } from "./FinanceOs";
import { FinanceOverview } from "./FinanceOverview";
import { BooksFilter } from "./BooksFilter";
import { FinanceEquity, FinanceForecast, FinanceInvest, FinanceTax } from "./FinanceDesks";
import {
  downloadEarningsFile,
  earningsPeriodRange,
  formatEarningsMoney,
  invoiceDraftCsv,
  safePaymentUrl,
  type EarningsPeriod,
} from "./earnings-ui";
import "./earnings-workspace.css";
import "./spend-sankey.css";

const FILTERS: { value: EarningsFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "invoices", label: "Invoices" },
  { value: "gallery", label: "Gallery orders" },
  { value: "expenses", label: "Expenses" },
  { value: "payouts", label: "Payouts" },
];
const TYPES = ["Balance", "Deposit", "Cash payment", "Expense"];
const CATEGORIES = [
  "Equipment",
  "Car & mileage",
  "Contract labor",
  "Albums & prints",
  "Software & subscriptions",
  "Travel",
  "Insurance",
  "Studio rental",
  "Advertising",
  "Other",
];
const typeLabel = (row: EarningsRow) =>
  row.accounting === "refund"
    ? "Refund"
    : row.type === "payment"
      ? /deposit|retainer/i.test(row.category)
        ? "Deposit"
        : "Payment"
      : row.type === "gallery"
        ? "Gallery sale"
        : row.type.charAt(0).toUpperCase() + row.type.slice(1);
const sourceLabel = (row: EarningsRow) =>
  ({
    manual: "Manual",
    "local-draft": "Local draft",
    invoice: "Invoice",
    stripe: "Stripe",
    legacy: "Legacy import",
  })[row.source];

export function EarningsWorkspace() {
  const identity = useAccount();
  return (
    <Shell hideEventHeader quietWorkspace>
      <EarningsContent key={identity?.scope ?? "none"} />
    </Shell>
  );
}

function EarningsContent() {
  const data = useEarningsData();
  const account = useAccount();
  const receiptBusinessName = account?.name ?? "";
  const workbench = useWorkbench();
  const directory = useShootNavigationData(data.owner, data.localMode);
  const [period, setPeriod] = useState<EarningsPeriod>("month");
  const [currency, setCurrency] = useState("USD");
  const [filter, setFilter] = useState<EarningsFilter>("all");
  const [query, setQuery] = useState("");
  const [shootFilter, setShootFilter] = useState(() => {
    if (typeof window === "undefined") return "";
    const value = new URL(window.location.href).searchParams.get("shoot") ?? "";
    return parseShootKey(value) ? value : "";
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [formKind, setFormKind] = useState<"invoice" | "entry" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [desk, setDesk] = useState<FinanceDesk>(() => readFinanceDesk());
  const openDesk = (next: FinanceDesk) => {
    setDesk(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "earnings") url.searchParams.delete("desk");
    else url.searchParams.set("desk", next);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    requestAnimationFrame(() => {
      if (document.querySelector('.earnings-sheet[data-state="open"]')) return;
      if (opener.current?.isConnected) opener.current.focus();
      else document.getElementById("earnings-title")?.focus();
    });
  };
  const today = localDate(new Date());
  const year = Number(today.slice(0, 4));
  const [goalMinor, setGoalMinor] = useState<number | null>(() =>
    account?.scope ? readRevenueGoal(account.scope, year) : null,
  );
  const dateRange = useMemo(() => earningsPeriodRange(period, today), [period, today]);
  const shoots = data.localMode
    ? directory.rows.map((row) => ({ id: row.key, name: row.title }))
    : data.shoots;
  const shootName = (id: string | null) =>
    id ? (shoots.find((row) => row.id === id)?.name ?? "Shoot unavailable") : "Link shoot";
  const open = async (href: string) => {
    if (workbench) return workbench.openTool(href);
    window.location.assign(href);
    return true;
  };
  const remoteProjection = useMemo((): { invoices: EarningsInvoice[]; error: string } => {
    try {
      const verified = new Set(data.snapshot?.invoices.map((row) => row.id) ?? []);
      const invoices: EarningsInvoice[] = data.invoices
        .filter((row) => !verified.has(row.id))
        .map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          dueDate: row.due_date,
          amountMinor: decimalToMinorUnits(row.amount, row.currency.toUpperCase()),
          outstandingMinor: 0,
          currency: row.currency.toUpperCase(),
          status: row.status === "sent" ? "open" : row.status,
          shootId: row.shoot_id,
          clientId: row.client_id,
          clientName: data.clients.find((client) => client.id === row.client_id)?.name ?? null,
        }));
      return { invoices, error: "" };
    } catch {
      return {
        invoices: [],
        error: "A saved invoice's amount or currency could not be read safely.",
      };
    }
  }, [data.invoices, data.clients, data.snapshot]);
  const remoteInvoices = remoteProjection.invoices;
  const ledger = useMemo(() => {
    try {
      if (remoteProjection.error) throw new Error(remoteProjection.error);
      const value = buildEarningsLedger({
        local: data.local,
        payments: data.snapshot?.receipts ?? [],
        invoices: [...(data.snapshot?.invoices ?? []), ...remoteInvoices],
        legacyTransactions: data.transactions,
        period: dateRange,
        today,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        providerComplete:
          data.localMode ||
          data.snapshot?.connection === "not-connected" ||
          data.snapshot?.complete === true,
        ...(shootFilter ? { shootId: shootFilter } : {}),
      });
      for (const row of value.rows) {
        if (row.status === "open")
          row.status = row.dueDate && row.dueDate < today ? "overdue" : "upcoming";
        const unverified = remoteInvoices.find(
          (invoice) => invoice.id === row.sourceId && invoice.status === "open",
        );
        if (row.source === "invoice" && unverified) {
          row.status = "unverified";
          row.warnings.push(
            "This sent invoice's current balance could not be verified. It is excluded from outstanding until Stripe is refreshed.",
          );
        }
      }
      return { ...value, error: "" };
    } catch {
      return {
        rows: [],
        metrics: [],
        warnings: [],
        complete: false,
        error:
          "Some recorded amounts or dates could not be read safely. Totals are unavailable; source records have not changed.",
      };
    }
  }, [
    data.local,
    data.localMode,
    data.snapshot,
    data.transactions,
    remoteInvoices,
    remoteProjection.error,
    dateRange,
    today,
    shootFilter,
  ]);
  const currencies = [...new Set([currency, ...ledger.metrics.map((row) => row.currency)])].sort();
  const metric = ledger.metrics.find((row) => row.currency === currency);
  const rows = filterEarningsRows(ledger.rows, {
    period: filter === "invoices" ? { from: null, to: null } : dateRange,
    filter,
    ...(shootFilter ? { shootId: shootFilter } : {}),
  }).filter(
    (row) =>
      (!row.currency || row.currency === currency) &&
      `${row.description} ${row.who ?? ""} ${shootName(row.shootId)} ${row.status}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  const selectedRow = ledger.rows.find((row) => row.id === selected) ?? null;
  const localDraft = data.local.invoices.find((row) => row.id === selectedRow?.sourceId);
  const remoteInvoice = data.invoices.find((row) => row.id === selectedRow?.sourceId);
  const providerInvoice = data.snapshot?.invoices.find((row) => row.id === selectedRow?.sourceId);
  const safeInvoiceUrl = safePaymentUrl(providerInvoice?.hostedInvoiceUrl);
  const connection = data.localMode
    ? "Local workspace · Stripe not connected"
    : data.snapshot?.connection === "connected"
      ? `Stripe ${data.snapshot.complete ? "verified" : "partially loaded"}`
      : data.snapshot?.connection === "not-connected"
        ? "Stripe not connected"
        : "Stripe unavailable";
  const unavailable = data.loading || !!data.error || !!ledger.error || !ledger.complete;
  const charts = useMemo(() => {
    if (unavailable) return null;
    try {
      return buildEarningsCharts(ledger.rows, {
        period: dateRange,
        granularity: period === "month" ? "day" : "month",
        today,
        currency,
        ...(shootFilter ? { shootId: shootFilter } : {}),
        complete: ledger.complete,
      });
    } catch {
      return null;
    }
  }, [unavailable, ledger.rows, ledger.complete, dateRange, period, today, currency, shootFilter]);
  const books = useMemo(() => {
    if (unavailable) return null;
    try {
      return buildPhotographerBooks(ledger.rows, {
        period: dateRange,
        today,
        currency,
        ...(shootFilter ? { shootId: shootFilter } : {}),
      });
    } catch {
      return null;
    }
  }, [unavailable, ledger.rows, dateRange, today, currency, shootFilter]);
  const yearCollectedMinor = useMemo(() => {
    if (unavailable) return 0;
    try {
      return (
        summarizeEarnings(ledger.rows, {
          period: { from: `${year}-01-01`, to: today },
          today,
          currency,
        }).find((row) => row.currency === currency)?.collectedMinor ?? 0
      );
    } catch {
      return 0;
    }
  }, [unavailable, ledger.rows, year, today, currency]);
  const money = (value: number | undefined) =>
    unavailable ? "—" : formatEarningsMoney(value ?? 0, currency);
  const balancesAvailable =
    !data.localMode &&
    data.snapshot?.connection === "connected" &&
    data.snapshot.complete &&
    !remoteInvoices.some((invoice) => invoice.status === "open");
  const galleryAvailable = ledger.rows.some(
    (row) => row.type === "gallery" && row.eligibleForTotals,
  );
  const newForm = (kind: "invoice" | "entry") => {
    setNotice("");
    setSelected(null);
    setEditingId(null);
    setFormKind(kind);
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "The action could not be completed. Your records are unchanged.",
      );
    } finally {
      setBusy(false);
    }
  };
  const sendDraft = () =>
    void run(async () => {
      if (!remoteInvoice || data.localMode) return;
      const response = await sendInvoice({
        data: { id: remoteInvoice.id, expected_updated_at: remoteInvoice.updated_at },
      });
      if (response.error) throw new Error(response.error);
      setNotice(response.notice ?? "Stripe accepted the request. Refresh for its current status.");
      await data.refresh();
    });

  return (
    <section
      className="earnings-workspace finance-os-host"
      aria-labelledby="earnings-title"
      onClickCapture={(event) => {
        if (!formKind && !selectedRow && event.target instanceof Element)
          opener.current = event.target.closest<HTMLElement>("button, tr[tabindex]");
      }}
      onKeyDownCapture={(event) => {
        if (
          !formKind &&
          !selectedRow &&
          (event.key === "Enter" || event.key === " ") &&
          event.target instanceof HTMLElement
        )
          opener.current = event.target;
      }}
    >
      <FinanceOs
        desk={desk}
        onDesk={openDesk}
        trailing={
          <div className="earnings-actions">
            <button onClick={() => newForm("entry")} disabled={!data.writable}>
              Add
            </button>
            <button
              className="earnings-primary finance-os__cta"
              onClick={() => newForm("invoice")}
              disabled={!data.writable}
            >
              Invoice
            </button>
          </div>
        }
      >
        <div className="earnings-toolbar">
          <div className="earnings-actions">
            <BooksFilter
              label="Earnings period"
              value={period}
              options={[
                { value: "month", label: "This month" },
                { value: "year", label: "This year" },
                { value: "all", label: "All dates" },
              ]}
              onChange={(value) => setPeriod(value as EarningsPeriod)}
            />
            <BooksFilter
              label="Currency"
              value={currency}
              options={currencies.map((code) => ({ value: code, label: code }))}
              onChange={setCurrency}
            />
            <BooksFilter
              label="Filter by shoot"
              value={shootFilter}
              options={[
                { value: "", label: "All shoots" },
                ...(shootFilter && !shoots.some((shoot) => shoot.id === shootFilter)
                  ? [{ value: shootFilter, label: shootName(shootFilter) }]
                  : []),
                ...shoots.map((shoot) => ({ value: shoot.id, label: shoot.name })),
              ]}
              onChange={setShootFilter}
            />
          </div>
          <div className="earnings-connection">
            <span>{connection}</span>
            {!data.localMode && data.snapshot?.connection === "not-connected" && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const response = await startStripeConnect();
                    if (response.error || !response.url)
                      throw new Error(response.error ?? "Stripe did not return a connection link.");
                    const url = new URL(response.url);
                    if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com")
                      throw new Error("Invalid Stripe connection destination.");
                    window.location.assign(url.href);
                  })
                }
              >
                Connect Stripe
                <ArrowUpRight size={12} />
              </button>
            )}
            <button
              onClick={() => void data.refresh()}
              disabled={data.loading}
              aria-label="Refresh earnings"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
        {(data.error || ledger.error) && (
          <p className="earnings-notice earnings-error" role="alert">
            {data.error || ledger.error}
          </p>
        )}
        {data.localMode && directory.error && (
          <p className="earnings-notice earnings-error" role="alert">
            {directory.error}
          </p>
        )}
        {!data.loading && !ledger.complete && !ledger.error && (
          <p className="earnings-notice" role="status">
            Payment history is incomplete. Available records are shown; totals stay unavailable
            until they can be verified.
          </p>
        )}
        {notice && !formKind && !selectedRow && (
          <p className="earnings-notice" role="status">
            {notice}
          </p>
        )}
        {desk === "earnings" || desk === "spending" ? (
          <FinanceOverview
            key={desk}
            spending={desk === "spending"}
            range={period === "all" ? "ALL" : period === "year" ? "YTD" : "1M"}
            books={books}
            balancesAvailable={Boolean(balancesAvailable)}
            rows={ledger.rows.filter((row) => !shootFilter || row.shootId === shootFilter)}
            today={today}
            money={(value) => formatEarningsMoney(value, currency)}
            onOpen={(id) => {
              setNotice("");
              setSelected(id);
            }}
            onRange={(next) => {
              if (next === "YTD") setPeriod("year");
              else if (next === "ALL") setPeriod("all");
              else setPeriod("month");
            }}
            yearCollectedMinor={yearCollectedMinor}
            goalMinor={goalMinor}
            onGoal={(minor) => {
              if (!account?.scope) return;
              writeRevenueGoal(account.scope, year, minor);
              setGoalMinor(minor);
            }}
            askBusy={busy}
            onAsk={(amount) => {
              void run(async () => {
                const built = buildLocalInvoiceDraft(
                  {
                    clientName: "Pay request",
                    clientEmail: "",
                    description: "Pay request",
                    amount,
                    currency,
                    shootId: shootFilter || null,
                    dueDate: today,
                  },
                  {},
                );
                if (!built.ok) throw new Error(built.error);
                if (!data.localMode) {
                  throw new Error("Open a shoot invoice to request payment on this account.");
                }
                const saved = await commitLocalFinanceState(
                  upsertLocalInvoiceDraft(data.local, built.value),
                );
                if (!saved.ok) throw new Error(saved.error);
                earningsChanged();
                await data.refresh();
                setNotice("Draft saved. It is not counted as income.");
              });
            }}
          />
        ) : desk === "invest" ? (
          <FinanceInvest
            books={books}
            rows={ledger.rows}
            money={(value) => formatEarningsMoney(value, currency)}
            scope={{
              currency,
              period: dateRange,
              ...(shootFilter ? { shootId: shootFilter } : {}),
              complete: !unavailable,
            }}
          />
        ) : desk === "equity" ? (
          <FinanceEquity
            books={books}
            balancesAvailable={Boolean(balancesAvailable)}
            money={(value) => formatEarningsMoney(value, currency)}
          />
        ) : desk === "forecast" ? (
          <FinanceForecast
            scope={{
              currency,
              period: dateRange,
              ...(shootFilter ? { shootId: shootFilter } : {}),
              complete: !unavailable,
              invoiceBalancesAvailable: Boolean(balancesAvailable),
            }}
            rows={ledger.rows}
            today={today}
            money={(value) => formatEarningsMoney(value, currency)}
            onOpen={(id) => {
              setNotice("");
              setSelected(id);
            }}
          />
        ) : desk === "tax" ? (
          <FinanceTax books={books} money={(value) => formatEarningsMoney(value, currency)} />
        ) : (
          <>
            <dl className="earnings-pulse">
              <div>
                <dt>Collected</dt>
                <dd>{money(metric?.collectedMinor)}</dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd>{balancesAvailable ? money(metric?.outstandingMinor) : "—"}</dd>
              </div>
              <div>
                <dt>Overdue</dt>
                <dd>{balancesAvailable ? money(metric?.overdueMinor) : "—"}</dd>
              </div>
              <div>
                <dt>Gallery</dt>
                <dd>{galleryAvailable ? money(metric?.gallerySalesMinor) : "—"}</dd>
              </div>
              <div>
                <dt>Net</dt>
                <dd>{money(metric?.netMinor)}</dd>
              </div>
            </dl>
            {books ? <BooksDashboard books={books} stripeLabel={connection} /> : null}
            <EarningsCharts
              model={charts}
              loading={data.loading}
              scopeLabel={`${period === "month" ? "This Month" : period === "year" ? "This Year" : "All Dates"} · ${shootFilter ? shootName(shootFilter) : "All Shoots"}`}
            />
            <div className="earnings-ledger-heading">
              <h2>Ledger</h2>
              <button
                disabled={unavailable || !rows.length}
                onClick={() => {
                  try {
                    downloadEarningsFile(
                      earningsCsv(rows, shootName),
                      `foto-ledger-${period}-${currency}.csv`,
                    );
                  } catch {
                    setNotice("Export failed. Your records are unchanged.");
                  }
                }}
              >
                <ArrowDownToLine size={14} />
                Export CSV
              </button>
            </div>
            <div className="earnings-filter-bar">
              <div className="earnings-filters" aria-label="Ledger filters">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="earnings-actions">
                <label className="earnings-search">
                  <Search size={14} />
                  <input
                    aria-label="Search ledger"
                    placeholder="Search ledger"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="earnings-table-scroll">
              <table className="earnings-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Shoot</th>
                    <th>Who</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="earnings-amount">Amount</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      aria-label={`Open ${row.description}`}
                      aria-selected={selected === row.id}
                      onClick={() => {
                        setNotice("");
                        setSelected(row.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(row.id);
                        }
                      }}
                    >
                      <td className="earnings-muted">
                        {row.date
                          ? new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              ...(period === "all" ? { year: "numeric" } : {}),
                            })
                          : "Date unknown"}
                      </td>
                      <td>
                        {row.shootId && parseShootKey(row.shootId) ? (
                          <a
                            href={shootWorkspaceHref(row.shootId)}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (
                                !event.metaKey &&
                                !event.ctrlKey &&
                                !event.shiftKey &&
                                !event.altKey
                              ) {
                                event.preventDefault();
                                void open(shootWorkspaceHref(row.shootId!));
                              }
                            }}
                          >
                            {shootName(row.shootId)}
                          </a>
                        ) : (
                          <span className="earnings-muted">{shootName(row.shootId)}</span>
                        )}
                      </td>
                      <td title={row.description}>
                        {row.who ??
                          data.clients.find((client) => client.id === row.clientId)?.name ??
                          row.description}
                      </td>
                      <td>{typeLabel(row)}</td>
                      <td>
                        <span className="earnings-status" data-status={row.status}>
                          {row.status.replaceAll("-", " ")}
                        </span>
                      </td>
                      <td className="earnings-amount">
                        {row.accounting === "expense" ? "−" : ""}
                        {row.currency
                          ? formatEarningsMoney(row.amountMinor, row.currency)
                          : `${minorUnitsDecimal(row.amountMinor, "USD")} · currency unknown`}
                      </td>
                      <td className="earnings-muted">{sourceLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="earnings-empty">
                <FileText size={27} strokeWidth={1.4} />
                <h3>
                  {data.loading
                    ? "Opening earnings…"
                    : query || shootFilter
                      ? "No matching entries"
                      : filter === "invoices"
                        ? "Your next shoot starts with an invoice"
                        : filter === "gallery"
                          ? "No gallery payments yet"
                          : filter === "payouts"
                            ? "No recorded payouts"
                            : filter === "expenses"
                              ? "No expenses in this period"
                              : "Your work. Your first payment."}
                </h3>
                <p>
                  {data.loading
                    ? "Reading saved records."
                    : filter === "gallery"
                      ? "Gallery checkout isn’t connected yet. Only verified gallery payments will appear here."
                      : filter === "payouts"
                        ? "Payouts are transfers, not additional income. Live payout reporting isn’t connected here yet."
                        : "Create an invoice for a shoot, or record a payment you’ve already received."}
                </p>
                {!data.loading && !query && filter !== "gallery" && filter !== "payouts" && (
                  <button
                    onClick={() => newForm(filter === "expenses" ? "entry" : "invoice")}
                    disabled={!data.writable}
                  >
                    {filter === "expenses" ? "Record an expense" : "Create invoice"}
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            )}
            {!!rows.length && (
              <p className="earnings-note">
                {rows.length} {rows.length === 1 ? "entry" : "entries"}
                {rows.some((row) => !row.linked)
                  ? " · Unlinked historical entries are preserved. Open a manual entry to link its shoot."
                  : ""}
              </p>
            )}
            {(metric?.unlinkedMinor ?? 0) > 0 && (
              <p className="earnings-notice">
                {formatEarningsMoney(metric!.unlinkedMinor, currency)} in unlinked Stripe payments
                is excluded from shoot earnings.
              </p>
            )}
            {!!data.snapshot?.warnings.length && (
              <p className="earnings-note">{data.snapshot.warnings.join(" ")}</p>
            )}
            <details className="earnings-method">
              <summary>How these numbers work</summary>
              <p>
                Collected is recorded payments less dated refunds in the selected period. Net Cash
                Flow subtracts recorded expenses. It is not profit, taxable income or a bank
                balance; it does not include unrecorded fees or other unrecorded costs. Outstanding
                and overdue use verified issued invoice balances as of today. Drafts, failed
                payments, test charges and payouts are not income. Gallery Sales is part of
                Collected, not additional income. Currencies are never combined.
              </p>
              <p>
                {data.localMode
                  ? "This local workspace saves cash entries and invoice drafts on this device. It does not send invoices or verify Stripe payments. Local drafts are not included in outstanding."
                  : "Stripe amounts are read from the connected photographer account. Unmatched imports remain available for audit but are not counted twice."}{" "}
                SmartFile deposits and gallery checkout are not connected yet.
              </p>
              {ledger.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </details>
          </>
        )}
      </FinanceOs>

      <Sheet
        open={!!selectedRow && !formKind}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
      >
        <SheetContent className="earnings-sheet" onCloseAutoFocus={restoreFocus}>
          <SheetTitle>{selectedRow?.description ?? "Entry details"}</SheetTitle>
          <SheetDescription data-description>
            Payment details and the shoot behind them.
          </SheetDescription>
          {selectedRow && (
            <>
              <p className="earnings-detail-amount">
                {selectedRow.currency
                  ? formatEarningsMoney(
                      selectedRow.accounting === "expense"
                        ? -selectedRow.amountMinor
                        : selectedRow.amountMinor,
                      selectedRow.currency,
                    )
                  : `${minorUnitsDecimal(selectedRow.amountMinor, "USD")} · currency unknown`}
              </p>
              <dl className="earnings-details">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className="earnings-status" data-status={selectedRow.status}>
                      {selectedRow.status}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Shoot</dt>
                  <dd>{shootName(selectedRow.shootId)}</dd>
                </div>
                <div>
                  <dt>Who</dt>
                  <dd>{selectedRow.who ?? selectedRow.description}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{selectedRow.date ?? "Unknown"}</dd>
                </div>
                {selectedRow.dueDate && (
                  <div>
                    <dt>Due date</dt>
                    <dd>{selectedRow.dueDate}</dd>
                  </div>
                )}
                <div>
                  <dt>Type</dt>
                  <dd>{typeLabel(selectedRow)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{sourceLabel(selectedRow)}</dd>
                </div>
                {selectedRow.category && (
                  <div>
                    <dt>Category</dt>
                    <dd>{selectedRow.category}</dd>
                  </div>
                )}
                {selectedRow.paymentMethod && (
                  <div>
                    <dt>Payment method</dt>
                    <dd>{selectedRow.paymentMethod}</dd>
                  </div>
                )}
              </dl>
              <div className="earnings-detail-actions">
                <button
                  onClick={() =>
                    downloadEarningsFile(
                      earningsCsv([selectedRow], shootName),
                      `foto-entry-${selectedRow.sourceId}.csv`,
                    )
                  }
                >
                  Export record
                  <ArrowDownToLine size={14} />
                </button>
                {selectedRow.shootId && parseShootKey(selectedRow.shootId) && (
                  <button
                    onClick={() => {
                      void open(shootWorkspaceHref(selectedRow.shootId!));
                      setSelected(null);
                    }}
                  >
                    Open shoot
                    <ArrowUpRight size={14} />
                  </button>
                )}
                {data.localMode && selectedRow.source === "manual" && (
                  <button
                    onClick={() => {
                      setEditingId(selectedRow.sourceId);
                      setFormKind("entry");
                    }}
                  >
                    Edit / link shoot
                  </button>
                )}
                {selectedRow.status === "draft" &&
                  (localDraft ||
                    (remoteInvoice && remoteInvoice.currency.toUpperCase() === "USD")) && (
                    <button
                      onClick={() => {
                        setEditingId(selectedRow.sourceId);
                        setFormKind("invoice");
                      }}
                    >
                      Edit draft
                    </button>
                  )}
                {localDraft && (
                  <button
                    onClick={() =>
                      downloadEarningsFile(
                        invoiceDraftCsv(localDraft),
                        `foto-invoice-draft-${localDraft.id}.csv`,
                      )
                    }
                  >
                    Export draft
                    <ArrowDownToLine size={14} />
                  </button>
                )}
                {remoteInvoice?.status === "draft" && !data.localMode && (
                  <button
                    disabled={
                      busy ||
                      data.snapshot?.connection !== "connected" ||
                      remoteInvoice.currency.toUpperCase() !== "USD"
                    }
                    onClick={sendDraft}
                  >
                    Send invoice
                  </button>
                )}
                {safeInvoiceUrl && (
                  <a
                    className="earnings-button"
                    href={safeInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open invoice
                    <ArrowUpRight size={14} />
                  </a>
                )}
                {safeInvoiceUrl && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(safeInvoiceUrl);
                        setNotice("Invoice link copied. You can include it in a reminder.");
                      })
                    }
                  >
                    Copy reminder link
                  </button>
                )}
              </div>
              <CustomerReceipt
                row={selectedRow}
                snapshot={data.snapshot}
                studioName={receiptBusinessName}
                customerName={
                  selectedRow.who ??
                  data.clients.find((client) => client.id === selectedRow.clientId)?.name ??
                  ""
                }
                shootName={shoots.find((shoot) => shoot.id === selectedRow.shootId)?.name ?? ""}
                unavailable={unavailable}
              />
              {selectedRow.source === "stripe" && (
                <p className="earnings-note">
                  Refunds are read from Stripe. This page never issues a refund automatically; use
                  your connected Stripe dashboard to review a payment.
                </p>
              )}
              {localDraft && (
                <p className="earnings-note">
                  Draft saved on this device, not sent. Sending and payment collection require an
                  authenticated Stripe-connected workspace.
                </p>
              )}
              {remoteInvoice?.status === "draft" &&
                remoteInvoice.currency.toUpperCase() !== "USD" && (
                  <p className="earnings-note">
                    This {remoteInvoice.currency.toUpperCase()} draft is preserved. In-app editing
                    and sending currently support USD drafts only.
                  </p>
                )}
              {selectedRow.warnings.map((warning) => (
                <p className="earnings-note" key={warning}>
                  {warning}
                </p>
              ))}
              {notice && (
                <p className="earnings-notice" role="status">
                  {notice}
                </p>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!formKind}
        onOpenChange={(value) => {
          if (!value && !busy) setFormKind(null);
        }}
      >
        <SheetContent className="earnings-sheet" onCloseAutoFocus={restoreFocus}>
          <SheetTitle>
            {editingId
              ? formKind === "invoice"
                ? "Edit invoice draft"
                : "Edit recorded entry"
              : formKind === "invoice"
                ? "New invoice"
                : "Record a payment or expense"}
          </SheetTitle>
          <SheetDescription data-description>
            {formKind === "invoice"
              ? "Keep the client, amount and due date with the shoot."
              : "For cash, bank payments and costs you’ve already incurred."}
          </SheetDescription>
          {formKind && (
            <EarningsForm
              key={`${formKind}:${editingId}`}
              kind={formKind}
              editId={editingId}
              shoots={shoots}
              data={data}
              initialShoot={shootFilter}
              busy={busy}
              setBusy={setBusy}
              onSaved={async () => {
                setFormKind(null);
                setSelected(null);
                earningsChanged();
                await data.refresh();
                setNotice(
                  formKind === "invoice"
                    ? "Invoice draft saved. It is not counted as income."
                    : "Entry saved and linked to its shoot.",
                );
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function EarningsForm({
  kind,
  editId,
  shoots,
  data,
  initialShoot,
  busy,
  setBusy,
  onSaved,
}: {
  kind: "invoice" | "entry";
  editId: string | null;
  shoots: { id: string; name: string }[];
  data: ReturnType<typeof useEarningsData>;
  initialShoot: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  // Keep the revision the user actually opened. A background refresh must not
  // make stale form values look like an edit of the newer ledger revision.
  const [base] = useState(() => ({
    local: data.local,
    draft: data.local.invoices.find((row) => row.id === editId),
    entry: data.local.entries.find((row) => row.id === editId),
    remote: data.invoices.find((row) => row.id === editId),
  }));
  const { draft, entry, remote } = base;
  const [form, setForm] = useState(() => ({
    shootId: draft?.shootId ?? entry?.shootId ?? remote?.shoot_id ?? initialShoot,
    clientId: draft?.clientId ?? entry?.clientId ?? remote?.client_id ?? "",
    clientName: draft?.clientName ?? entry?.clientName ?? "",
    clientEmail: draft?.clientEmail ?? "",
    description: draft?.description ?? entry?.description ?? remote?.description ?? "",
    currency: draft?.currency ?? entry?.currency ?? remote?.currency.toUpperCase() ?? "USD",
    amount:
      draft || entry
        ? minorUnitsDecimal((draft ?? entry)!.amountCents, (draft ?? entry)!.currency ?? "USD")
        : remote
          ? String(remote.amount)
          : "",
    date: entry?.occurredOn ?? localDate(new Date()),
    dueDate: draft?.dueDate ?? remote?.due_date ?? "",
    type: entry?.kind === "expense" ? "Expense" : (entry?.category ?? "Balance"),
    category: entry?.category ?? "Equipment",
    paymentMethod: entry?.paymentMethod ?? "cash",
  }));
  const [error, setError] = useState("");
  const update = (key: keyof typeof form, value: string) =>
    setForm((old) => ({ ...old, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!form.shootId || !shoots.some((shoot) => shoot.id === form.shootId)) {
      setError("Choose the shoot this belongs to. No entry was saved.");
      return;
    }
    if (!form.description.trim() || parseFinanceAmount(form.amount, form.currency) === null) {
      setError("Add a description and a valid positive amount.");
      return;
    }
    setBusy(true);
    try {
      if (data.localMode) {
        let next: LocalFinanceState;
        if (kind === "invoice") {
          const built = buildLocalInvoiceDraft(
            { ...form, clientId: form.clientId || null },
            draft ? { id: draft.id, createdAt: draft.createdAt } : {},
          );
          if (!built.ok) throw new Error(built.error);
          next = upsertLocalInvoiceDraft(base.local, { ...draft, ...built.value });
        } else {
          const built = buildLocalLedgerEntry(
            {
              ...form,
              occurredOn: form.date,
              kind: form.type === "Expense" ? "expense" : "income",
              category: form.type === "Expense" ? form.category : form.type,
              clientName: form.clientName || null,
              clientId: form.clientId || null,
              paymentMethod: form.paymentMethod as "cash" | "check" | "bank" | "other",
            },
            entry ? { id: entry.id, createdAt: entry.createdAt } : {},
          );
          if (!built.ok) throw new Error(built.error);
          next = upsertLocalLedgerEntry(base.local, { ...entry, ...built.value });
        }
        const saved = await commitLocalFinanceState(next);
        if (!saved.ok) throw new Error(saved.error);
      } else if (kind === "invoice") {
        if (!form.clientId) throw new Error("Choose an existing client before saving the invoice.");
        let clientId = form.clientId;
        if (clientId === "new-client") {
          if (!form.clientName.trim()) throw new Error("Add the client's name.");
          const response = await saveClient({
            data: {
              name: form.clientName.trim(),
              ...(form.clientEmail.trim() ? { email: form.clientEmail.trim() } : {}),
            },
          });
          if (response.error || !response.client)
            throw new Error(response.error ?? "Client could not be saved.");
          clientId = response.client.id;
          update("clientId", clientId);
        }
        const saved = await saveInvoiceDraft({
          data: {
            ...(remote ? { id: remote.id, expected_updated_at: remote.updated_at } : {}),
            client_id: clientId,
            shoot_id: form.shootId,
            amount: parseFinanceAmount(form.amount)! / 100,
            description: form.description,
            due_date: form.dueDate || null,
          },
        });
        if (saved.error) throw new Error(saved.error);
      } else {
        const saved = await addTransaction({
          data: {
            kind: form.type === "Expense" ? "expense" : "income",
            category: form.type === "Expense" ? form.category : form.type,
            description: form.description,
            amount: parseFinanceAmount(form.amount)! / 100,
            occurred_on: form.date,
            shoot_id: form.shootId,
            client_id: form.clientId || null,
          },
        });
        if (saved.error) throw new Error(saved.error);
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="earnings-form" onSubmit={(event) => void save(event)}>
      <label>
        Shoot
        <select
          required
          value={form.shootId}
          onChange={(event) => update("shootId", event.target.value)}
        >
          <option value="">Choose a shoot</option>
          {shoots.map((shoot) => (
            <option key={shoot.id} value={shoot.id}>
              {shoot.name}
            </option>
          ))}
        </select>
      </label>
      {!shoots.length && (
        <p className="earnings-note">
          Create a shoot from the sidebar first. Every new entry stays linked to its work.
        </p>
      )}
      {!data.localMode ? (
        <label>
          Client
          <select
            required={kind === "invoice"}
            value={form.clientId}
            onChange={(event) => update("clientId", event.target.value)}
          >
            <option value="">Choose a client</option>
            {kind === "invoice" && <option value="new-client">+ New client</option>}
            {data.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.org || client.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {kind === "invoice" ? "Client name" : "Who (client or supplier)"}
          <input
            required={kind === "invoice"}
            value={form.clientName}
            onChange={(event) => update("clientName", event.target.value)}
            placeholder={
              kind === "invoice" ? "Client or organization" : "Client, rental house, supplier…"
            }
          />
        </label>
      )}
      {kind === "invoice" && !data.localMode && form.clientId === "new-client" && (
        <label>
          Client name
          <input
            required
            value={form.clientName}
            onChange={(event) => update("clientName", event.target.value)}
            placeholder="Client or organization"
          />
        </label>
      )}
      {kind === "invoice" && (data.localMode || form.clientId === "new-client") && (
        <label>
          Client email
          <input
            type="email"
            value={form.clientEmail}
            onChange={(event) => update("clientEmail", event.target.value)}
            placeholder="client@example.com"
          />
        </label>
      )}
      <label>
        Description
        <input
          required
          value={form.description}
          onChange={(event) => update("description", event.target.value)}
          placeholder={
            kind === "invoice" ? "Game coverage + same-night selects" : "What was this payment for?"
          }
        />
      </label>
      {kind === "entry" && (
        <div className="earnings-form-two">
          <label>
            Type
            <select value={form.type} onChange={(event) => update("type", event.target.value)}>
              {[...new Set([form.type, ...TYPES])].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {form.type === "Expense" ? (
            <label>
              Category
              <select
                value={form.category}
                onChange={(event) => update("category", event.target.value)}
              >
                {[...new Set([form.category, ...CATEGORIES])].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : data.localMode ? (
            <label>
              Payment method
              <select
                value={form.paymentMethod}
                onChange={(event) => update("paymentMethod", event.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
          ) : (
            <p className="earnings-note">Include supplier and payment method in the description.</p>
          )}
        </div>
      )}
      <div className="earnings-form-two">
        <label>
          Amount
          <input
            required
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => update("amount", event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Currency
          <select
            disabled={!data.localMode || !!editId}
            value={form.currency}
            onChange={(event) => update("currency", event.target.value)}
          >
            {[
              ...new Set([form.currency, "USD", "CAD", "EUR", "GBP", "AUD", "JPY", "INR", "NPR"]),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {kind === "invoice" ? "Due date" : "Date received / paid"}
        <input
          type="date"
          required={kind === "entry"}
          value={kind === "invoice" ? form.dueDate : form.date}
          onChange={(event) => update(kind === "invoice" ? "dueDate" : "date", event.target.value)}
        />
      </label>
      {kind === "invoice" && (
        <p className="earnings-note">
          {data.localMode
            ? "Saved as a local draft. Nothing is emailed or charged."
            : "Save first, then review and send through Stripe from the invoice details."}
        </p>
      )}
      {error && (
        <p className="earnings-notice earnings-error" role="alert">
          {error}
        </p>
      )}
      <div className="earnings-actions">
        <button
          className="earnings-primary"
          disabled={busy || !data.writable || !shoots.length}
          type="submit"
        >
          {busy ? "Saving…" : kind === "invoice" ? "Save draft" : "Save entry"}
        </button>
      </div>
    </form>
  );
}
