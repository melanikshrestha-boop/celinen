import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { buildEarningsLedger, type EarningsRow } from "@/lib/earnings-ledger";
import { formatFinanceMoney } from "@/lib/finance-money";
import { localDate } from "@/lib/business/reminders";
import { parseShootKey } from "@/lib/workbench-projects";
import { ShootLink } from "@/components/shoots/ShootsHub";
import { useEarningsData } from "./useEarningsData";
import "./earnings-workspace.css";

function amounts(rows: readonly EarningsRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (
      !row.currency ||
      !row.eligibleForTotals ||
      (row.accounting !== "collection" && row.accounting !== "refund")
    )
      continue;
    const next = (totals.get(row.currency) ?? 0) + row.amountMinor;
    if (!Number.isSafeInteger(next)) throw new Error("Recorded deposits exceed safe precision.");
    totals.set(row.currency, next);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
}

/** Exact canonical key only: a project and directory with the same UUID cannot share a balance. */
export function ShootEarningsStrip({ shootKey }: { shootKey: string }) {
  if (!parseShootKey(shootKey)) return null;
  return <ShootEarningsContent key={shootKey} shootKey={shootKey} />;
}

function ShootEarningsContent({ shootKey }: { shootKey: string }) {
  const data = useEarningsData(),
    today = localDate();
  const summary = useMemo(() => {
    try {
      const payments = data.snapshot?.receipts ?? [];
      const ledger = buildEarningsLedger({
        local: data.local,
        legacyTransactions: data.transactions,
        payments,
        invoices: data.snapshot?.invoices ?? [],
        period: { from: null, to: today },
        today,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        shootId: shootKey,
        providerComplete:
          data.localMode ||
          data.snapshot?.connection === "not-connected" ||
          data.snapshot?.complete === true,
      });
      const selected = ledger.rows.filter(
        (row) => row.shootId === shootKey && row.date !== null && row.date <= today,
      );
      const depositPayments = payments.filter((payment) => payment.sourceKind === "deposit");
      const depositRows = new Set(
        depositPayments.flatMap((payment) => [
          `payment:${payment.id}`,
          ...payment.refunds.map((refund) => `refund:${payment.accountId}:${refund.id}`),
        ]),
      );
      const deposits = amounts(
        selected.filter(
          (row) =>
            (row.source === "manual" && row.category.trim().toLowerCase() === "deposit") ||
            depositRows.has(row.id),
        ),
      );
      const gallery = amounts(selected.filter((row) => row.type === "gallery"));
      const hasVerifiedInvoice =
        data.snapshot?.invoices.some(
          (invoice) => invoice.shootId === shootKey && invoice.livemode,
        ) ?? false;
      return { ledger, deposits, gallery, hasVerifiedInvoice, error: "" };
    } catch {
      return {
        ledger: null,
        deposits: [],
        gallery: [],
        hasVerifiedInvoice: false,
        error: "Shoot earnings could not be read safely. Existing records are unchanged.",
      };
    }
  }, [data.local, data.transactions, data.snapshot, data.localMode, shootKey, today]);
  const unavailable = data.loading || !!data.error || !!summary.error || !summary.ledger?.complete;
  const renderAmounts = (values: readonly (readonly [string, number])[]) =>
    unavailable || !values.length
      ? "—"
      : values.map(([currency, amount]) => (
          <span key={currency}>
            {formatFinanceMoney(amount, currency)}
            <br />
          </span>
        ));
  const balances = summary.hasVerifiedInvoice
    ? (summary.ledger?.metrics.map(
        (metric) => [metric.currency, metric.outstandingMinor] as const,
      ) ?? [])
    : [];
  return (
    <section className="shoot-earnings-strip" aria-label="Shoot earnings" aria-busy={data.loading}>
      <div className="earnings-ledger-heading">
        <h2>Earnings</h2>
        <ShootLink
          href={`/earnings?shoot=${encodeURIComponent(shootKey)}`}
          className="shoots-text-link"
        >
          Open earnings
          <ArrowUpRight size={15} />
        </ShootLink>
      </div>
      <dl className="earnings-pulse">
        <div>
          <dt>Quoted</dt>
          <dd>—</dd>
          <small>Quotes not connected</small>
        </div>
        <div>
          <dt>Deposited</dt>
          <dd>{renderAmounts(summary.deposits)}</dd>
          <small>Recorded deposits · after refunds</small>
        </div>
        <div>
          <dt>Balance</dt>
          <dd>{renderAmounts(balances)}</dd>
          <small>Verified open invoices</small>
        </div>
        <div>
          <dt>Gallery</dt>
          <dd>{renderAmounts(summary.gallery)}</dd>
          <small>Verified gallery payments</small>
        </div>
      </dl>
      {(data.error || summary.error) && (
        <p className="earnings-note earnings-error" role="alert">
          {data.error || summary.error}
        </p>
      )}
      {!data.loading && !data.error && !summary.error && !summary.ledger?.complete && (
        <p className="earnings-note">
          Provider history is incomplete; shoot totals are unavailable until refreshed.
        </p>
      )}
    </section>
  );
}
