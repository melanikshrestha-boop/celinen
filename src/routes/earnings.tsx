import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: [
      { title: "Earnings & Tax — Lens OS" },
      {
        name: "description",
        content:
          "Every photography earning and loss in one ledger, grouped into Schedule C expense categories and exportable as a tax-ready CSV or summary.",
      },
      { property: "og:title", content: "Earnings & Tax — Lens OS" },
      {
        property: "og:description",
        content: "Income, deductible expenses, mileage, quarterly estimates and a tax-ready export.",
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

const INCOME_CATEGORIES = ["Event coverage", "Licensing", "Print sales", "Retainer", "Other income"];

const SEED: Entry[] = [
  { id: "i1", date: "2026-08-22", label: "Halden Track Invitational — wire set", kind: "income", category: "Event coverage", amount: 1450, eventId: "e-invitational", source: "delivery" },
  { id: "i2", date: "2026-08-04", label: "Metro Wire licensing — 6 frames", kind: "income", category: "Licensing", amount: 380, eventId: null, source: "manual" },
  { id: "i3", date: "2026-07-19", label: "Northgate Prep retainer", kind: "income", category: "Retainer", amount: 900, eventId: "e-northgate", source: "manual" },
  { id: "e1", date: "2026-08-22", label: "Fuel + tolls to Halden Oval", kind: "expense", category: "Car & mileage", amount: 64, eventId: "e-invitational", source: "manual" },
  { id: "e2", date: "2026-08-01", label: "Adobe Photography Plan", kind: "expense", category: "Software & subscriptions", amount: 19.99, eventId: null, source: "imported" },
  { id: "e3", date: "2026-07-11", label: "70-200 f/2.8 service", kind: "expense", category: "Equipment & depreciation", amount: 310, eventId: null, source: "manual" },
  { id: "e4", date: "2026-07-02", label: "Second shooter — Kai", kind: "expense", category: "Contract labor (second shooter)", amount: 250, eventId: "e-invitational", source: "manual" },
  { id: "e5", date: "2026-06-15", label: "Gear insurance (quarterly)", kind: "expense", category: "Insurance", amount: 148, eventId: null, source: "manual" },
];

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function Earnings() {
  const { events } = useLens();
  const [entries, setEntries] = useState<Entry[]>(SEED);
  const [kind, setKind] = useState<Kind>("expense");
  const [form, setForm] = useState({
    date: "",
    label: "",
    category: EXPENSE_CATEGORIES[0]!,
    amount: "",
    eventId: "",
  });

  const totals = useMemo(() => {
    const income = entries.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amount, 0);
    return { income, expense, net: income - expense };
  }, [entries]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    entries
      .filter((e) => e.kind === "expense")
      .forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const selfEmployment = Math.max(0, totals.net) * 0.9235 * 0.153;
  const quarterly = (selfEmployment + Math.max(0, totals.net) * 0.15) / 4;

  const add = () => {
    const amount = Number(form.amount);
    if (!form.label.trim() || Number.isNaN(amount) || amount <= 0) return;
    setEntries((prev) => [
      {
        id: `x-${Math.random().toString(36).slice(2, 7)}`,
        date: form.date || new Date().toISOString().slice(0, 10),
        label: form.label.trim(),
        kind,
        category: form.category,
        amount,
        eventId: form.eventId || null,
        source: "manual",
      },
      ...prev,
    ]);
    setForm({ ...form, label: "", amount: "" });
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

  const cats = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <Shell hideEventHeader>
      <SectionTitle
        kicker="Earnings"
        title="Every dollar in, every dollar out — tax-ready."
        sub="Grouped into Schedule C categories. Nothing is estimated for you unless it is labelled an estimate."
      />

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
                    setForm({ ...form, category: (k === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]! });
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
              className="w-24 rounded-lg border border-input bg-card px-3 py-1.5 text-right font-mono text-[13px] outline-none"
            />
            <Btn variant="primary" className="px-3 py-1.5 text-[13px]" onClick={add}>
              Add
            </Btn>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 last:border-0">
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
                <button
                  onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                  className="text-[12px] text-moss hover:text-ink"
                >
                  ✕
                </button>
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
    </Shell>
  );
}
