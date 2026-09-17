import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ReceiptText } from "lucide-react";
import { MessageComposer } from "@/components/customer/MessageComposer";
import { localDate } from "@/lib/business/reminders";
import type { EarningsRow } from "@/lib/earnings-ledger";
import type { ConnectedEarningsSnapshot } from "@/lib/earnings/stripe-receipts";
import {
  customerReceiptFromEarnings,
  receiptUnavailable,
  RECEIPT_VERIFICATION_MAX_AGE_MS,
} from "@/lib/receipts/from-earnings";
import { renderCustomerReceipt } from "@/lib/receipts/native-client";
import type { CustomerReceiptModel } from "@/lib/receipts/protocol";
import { downloadEarningsFile, formatEarningsMoney } from "./earnings-ui";
import "./customer-receipt.css";

export function CustomerReceipt(props: {
  row: EarningsRow;
  snapshot: ConnectedEarningsSnapshot | null;
  studioName: string;
  customerName: string;
  shootName: string;
  unavailable: boolean;
}) {
  // A changed payment, provider snapshot, or owner unmounts the prepared artifact.
  const { snapshot, ...fields } = props;
  const proof = snapshot?.receipts.find((receipt) => receipt.chargeId === props.row.sourceId);
  const identity = {
    ...fields,
    proof,
    account: snapshot?.accountId,
    complete: snapshot?.complete,
    connection: snapshot?.connection,
    fetchedAt: snapshot?.fetchedAt,
  };
  return <ReceiptContent key={JSON.stringify(identity)} {...props} />;
}

function ReceiptContent({
  row,
  snapshot,
  studioName,
  customerName,
  shootName,
  unavailable,
}: Parameters<typeof CustomerReceipt>[0]) {
  const [studio, setStudio] = useState(studioName);
  const [customer, setCustomer] = useState(customerName);
  const [result, setResult] = useState<{
    html: string;
    text: string;
    model: CustomerReceiptModel;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (row.source !== "stripe") return;
    const remaining =
      Date.parse(snapshot?.fetchedAt ?? "") + RECEIPT_VERIFICATION_MAX_AGE_MS - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(
      () => {
        setResult(null);
        setError("Refresh Earnings to verify this payment again.");
      },
      Math.max(0, remaining + 1),
    );
    return () => clearTimeout(timer);
  }, [row.source, snapshot?.fetchedAt]);
  if (!["payment", "gallery"].includes(row.type) || row.accounting !== "collection") return null;
  const today = localDate();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const blocked = unavailable
    ? "Refresh Earnings before preparing a receipt."
    : receiptUnavailable(row, snapshot, today, timeZone);
  const ensureCurrent = () => {
    if (!alive.current || unavailable) throw new Error("Reopen this payment before sharing.");
    const reason = receiptUnavailable(row, snapshot, localDate(), timeZone);
    if (reason) throw new Error(reason);
  };
  return (
    <details className="customer-receipt">
      <summary>
        <ReceiptText size={16} />
        Customer Receipt
      </summary>
      {blocked ? (
        <p className="earnings-note">{blocked}</p>
      ) : (
        <>
          <p className="earnings-note">
            Create from this payment. The saved amount and ledger stay unchanged.
          </p>
          <label>
            Business Name
            <input
              maxLength={120}
              value={studio}
              disabled={busy}
              onChange={(event) => {
                setStudio(event.target.value);
                setResult(null);
              }}
            />
          </label>
          <label>
            Customer Name
            <input
              maxLength={120}
              value={customer}
              disabled={busy}
              onChange={(event) => {
                setCustomer(event.target.value);
                setResult(null);
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              controller.current?.abort();
              const abort = new AbortController();
              controller.current = abort;
              setBusy(true);
              setError("");
              setResult(null);
              try {
                const model = customerReceiptFromEarnings(row, {
                  today: localDate(),
                  studioName: studio,
                  customerName: customer,
                  shootName,
                  snapshot,
                  timeZone,
                });
                const artifact = await renderCustomerReceipt(model, abort.signal);
                if (alive.current && !abort.signal.aborted) {
                  ensureCurrent();
                  setResult({ ...artifact, model });
                }
              } catch (cause) {
                if (alive.current && !abort.signal.aborted)
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Receipt could not be prepared. Nothing changed.",
                  );
              } finally {
                if (alive.current && !abort.signal.aborted) setBusy(false);
              }
            }}
          >
            {busy ? "Preparing Receipt…" : result ? "Recreate Receipt" : "Create Receipt"}
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
              }}
            >
              Cancel
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {result && (
            <>
              <article className="customer-receipt-paper" aria-label="Customer receipt preview">
                <p>{result.model.studioName}</p>
                <span>Payment Receipt</span>
                <strong>
                  {formatEarningsMoney(result.model.amountMinor, result.model.currency)}
                </strong>
                <dl>
                  <div>
                    <dt>Customer</dt>
                    <dd>{result.model.customerName}</dd>
                  </div>
                  <div>
                    <dt>Shoot</dt>
                    <dd>{result.model.shootName}</dd>
                  </div>
                  <div>
                    <dt>For</dt>
                    <dd>{result.model.description}</dd>
                  </div>
                  <div>
                    <dt>Paid</dt>
                    <dd>{result.model.paidOn}</dd>
                  </div>
                  {result.model.paymentMethod && (
                    <div>
                      <dt>Method</dt>
                      <dd>{result.model.paymentMethod}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Record</dt>
                    <dd>{result.model.sourceLabel}</dd>
                  </div>
                </dl>
                <small>{result.model.receiptId}</small>
              </article>
              <button
                type="button"
                onClick={() => {
                  try {
                    ensureCurrent();
                    downloadEarningsFile(
                      result.html,
                      `celinen-receipt-${row.sourceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}.html`,
                      "text/html;charset=utf-8",
                    );
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Reopen this payment before downloading.",
                    );
                  }
                }}
              >
                <ArrowDownToLine size={15} />
                Download Receipt
              </button>
              <p className="earnings-note">
                Print-ready HTML. Open the downloaded receipt to print or save as PDF.
              </p>
              <MessageComposer
                title={`Payment Receipt — ${result.model.studioName}`}
                text={result.text}
                beforeAction={ensureCurrent}
              />
            </>
          )}
        </>
      )}
    </details>
  );
}
