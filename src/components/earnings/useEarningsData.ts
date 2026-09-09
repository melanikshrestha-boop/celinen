import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { listClients, listInvoices, listShoots, listTransactions } from "@/lib/finance.functions";
import { getConnectedEarningsSnapshot } from "@/lib/earnings/connected-earnings.functions";
import type { ConnectedEarningsSnapshot } from "@/lib/earnings/stripe-receipts";
import {
  emptyLocalFinanceState,
  loadLocalFinanceState,
  LOCAL_FINANCE_STORAGE_KEY,
  type LocalFinanceState,
} from "@/lib/local-finance-store";

export type FinanceClient = { id: string; name: string; org: string | null; email: string | null };
export type FinanceShoot = { id: string; name: string };
export type FinanceTransaction = {
  id: string;
  occurred_on: string;
  description: string;
  kind: "income" | "expense";
  category: string;
  amount: string | number;
  shoot_id: string | null;
  client_id?: string | null;
  source: string;
  stripe_object_id?: string | null;
};
export type FinanceInvoice = {
  currency: string;
  id: string;
  client_id: string | null;
  shoot_id: string | null;
  amount: string | number;
  description: string | null;
  status: "draft" | "sent" | "paid" | "void";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  stripe_invoice_id: string | null;
  hosted_invoice_url: string | null;
};
const blank = () => ({
  local: emptyLocalFinanceState(),
  transactions: [] as FinanceTransaction[],
  invoices: [] as FinanceInvoice[],
  clients: [] as FinanceClient[],
  shoots: [] as FinanceShoot[],
  snapshot: null as ConnectedEarningsSnapshot | null,
});

/** No mount-time seed or write. Account switches invalidate late responses. */
export function useEarningsData() {
  const account = useAccount();
  const owner = account?.scope ?? "";
  const generation = useRef(0);
  const [state, setState] = useState(() => ({
    ...blank(),
    owner,
    loading: true,
    error: "",
    writable: false,
  }));
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!owner) return;
    setState((old) => ({
      ...(old.owner === owner ? old : { ...blank(), owner, writable: false }),
      loading: true,
      error: "",
    }));
    try {
      if (isLocalSingleUserMode) {
        const loaded = loadLocalFinanceState();
        if (generation.current === request)
          setState({
            ...blank(),
            owner,
            local: loaded.state,
            loading: false,
            error: loaded.warning ?? "",
            writable: loaded.ok,
          });
      } else {
        const [transactions, invoices, clients, shoots, snapshot] = await Promise.all([
          listTransactions(),
          listInvoices(),
          listClients(),
          listShoots(),
          getConnectedEarningsSnapshot(),
        ]);
        if (generation.current === request)
          setState({
            local: emptyLocalFinanceState(),
            owner,
            transactions: transactions as FinanceTransaction[],
            invoices: invoices as FinanceInvoice[],
            clients: clients as FinanceClient[],
            shoots: shoots as FinanceShoot[],
            snapshot,
            loading: false,
            error: "",
            writable: true,
          });
      }
    } catch {
      if (generation.current === request)
        setState((old) => ({
          ...(old.owner === owner ? old : { ...blank(), owner }),
          loading: false,
          error:
            "Earnings could not be refreshed. Existing records are unchanged; totals may be out of date.",
          writable: false,
        }));
    }
  }, [owner]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    void refresh();
    const storage = (event: StorageEvent) => {
      if (event.key === LOCAL_FINANCE_STORAGE_KEY || event.key === null) void refresh();
    };
    const changed = () => void refresh();
    window.addEventListener("storage", storage);
    window.addEventListener("foto:earnings-changed", changed);
    window.addEventListener("focus", changed);
    return () => {
      invalidate();
      window.removeEventListener("storage", storage);
      window.removeEventListener("foto:earnings-changed", changed);
      window.removeEventListener("focus", changed);
    };
  }, [refresh, invalidate]);
  return {
    ...(state.owner === owner
      ? state
      : { ...blank(), owner, loading: true, error: "", writable: false }),
    refresh,
    localMode: isLocalSingleUserMode,
  };
}

export function earningsChanged() {
  window.dispatchEvent(new Event("foto:earnings-changed"));
}
export type EarningsLocalState = LocalFinanceState;
