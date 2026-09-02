import { useEffect, useState } from "react";
import { Btn, Card, Chip } from "@/components/lensos/Shell";
import {
  createInvoice,
  listClients,
  listInvoices,
  markInvoicePaid,
  saveClient,
} from "@/lib/finance.functions";

type Client = { id: string; name: string; org: string | null; email: string | null };
type Invoice = {
  id: string;
  client_id: string | null;
  amount: number | string;
  status: string;
  due_date: string | null;
  description: string | null;
  hosted_invoice_url: string | null;
};

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function InvoicePanel() {
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ client_id: "", amount: "", description: "", due_date: "" });
  const [newClient, setNewClient] = useState({ name: "", email: "" });

  const load = async () => {
    const [c, i] = await Promise.all([listClients(), listInvoices()]);
    setClients(c as never);
    setInvoices(i as never);
  };

  useEffect(() => {
    void load().catch(() => setNote("Sign in to manage invoices."));
  }, []);

  const addClient = async () => {
    if (!newClient.name.trim()) return;
    const res = (await saveClient({
      data: { name: newClient.name.trim(), email: newClient.email.trim() || undefined },
    })) as any;
    if (res?.error) return setNote(res.error);
    setNewClient({ name: "", email: "" });
    await load();
    setForm((f) => ({ ...f, client_id: res.client.id }));
  };

  const send = async (deliver: boolean) => {
    const amount = Number(form.amount);
    if (!form.client_id || !Number.isFinite(amount) || amount <= 0) {
      setNote("Pick a client and an amount.");
      return;
    }
    setBusy(true);
    const res = (await createInvoice({
      data: {
        client_id: form.client_id,
        amount,
        description: form.description || undefined,
        due_date: form.due_date || null,
        send: deliver,
      },
    })) as any;
    setBusy(false);
    setNote(res?.error ?? (deliver ? "Invoice sent through Stripe." : "Draft saved."));
    setForm({ client_id: form.client_id, amount: "", description: "", due_date: "" });
    await load();
  };

  const clientName = (id: string | null) => {
    const c = clients.find((x) => x.id === id);
    return c ? c.org || c.name : "—";
  };

  return (
    <Card className="mt-4 p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Invoices</p>
        <p className="ml-auto font-mono text-[11px] text-moss">
          sent through your connected Stripe account
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <select
          value={form.client_id}
          onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
        >
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.org || c.name}
            </option>
          ))}
        </select>
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What for"
          className="min-w-[160px] flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
        />
        <input
          type="date"
          value={form.due_date}
          onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
        />
        <input
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          placeholder="0.00"
          className="w-24 rounded-lg border border-input bg-card px-3 py-1.5 text-right font-mono text-[13px] outline-none"
        />
        <Btn className="px-3 py-1.5 text-[13px]" disabled={busy} onClick={() => void send(false)}>
          Save draft
        </Btn>
        <Btn
          variant="primary"
          className="px-3 py-1.5 text-[13px]"
          disabled={busy}
          onClick={() => void send(true)}
        >
          {busy ? "Sending…" : "Send invoice"}
        </Btn>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <input
          value={newClient.name}
          onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
          placeholder="New client name"
          className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
        />
        <input
          value={newClient.email}
          onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
          placeholder="client@email.com"
          className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
        />
        <Btn className="px-3 py-1.5 text-[13px]" onClick={() => void addClient()}>
          Add client
        </Btn>
        {note && <p className="ml-auto self-center font-mono text-[12px] text-moss">{note}</p>}
      </div>

      <div className="max-h-[320px] overflow-y-auto">
        {invoices.length === 0 && <p className="p-4 text-sm text-moss">No invoices yet.</p>}
        {invoices.map((inv) => (
          <div
            key={inv.id}
            className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 last:border-0"
          >
            <span className="text-sm">{clientName(inv.client_id)}</span>
            <span className="text-[13px] text-moss">{inv.description ?? "Photography services"}</span>
            <Chip tone={inv.status === "paid" ? "solid" : inv.status === "sent" ? "accent" : "quiet"}>
              {inv.status}
            </Chip>
            {inv.due_date && <span className="font-mono text-[11px] text-moss">due {inv.due_date}</span>}
            <span className="ml-auto font-mono text-[13px]">{money(Number(inv.amount))}</span>
            {inv.hosted_invoice_url && (
              <a
                href={inv.hosted_invoice_url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] underline"
              >
                open
              </a>
            )}
            {inv.status !== "paid" && (
              <button
                onClick={() => void markInvoicePaid({ data: { id: inv.id } }).then(load)}
                className="font-mono text-[12px] text-moss hover:text-ink"
              >
                mark paid
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
