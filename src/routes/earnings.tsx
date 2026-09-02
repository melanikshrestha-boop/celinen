import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";

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

function Earnings() {
  const { events, clients } = useLens();

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

  const scheduleC = useMemo(() => {
    const rows = new Map<string, { line: string; label: string; amount: number }>();
    for (const [cat, amount] of byCategory) {
      const map = SCHEDULE_C_LINE[cat] ?? SCHEDULE_C_LINE['Other']!;
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
        map.set(name, (map.get(name) ?? 0) + e.amount);
      });
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, events, clients]);

  const payees = useMemo(() => {
    const map = new Map<string, number>();
    entries
      .filter((e) => e.kind === "expense" && e.category.startsWith("Contract labor"))
      .forEach((e) => {
        const name = e.label.split("—").slice(-1)[0]!.trim() || e.label;
        map.set(name, (map.get(name) ?? 0) + e.amount);
      });
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [entries]);

  /* ---------- real shoot data wired into the ledger ---------- */
  const jobs = useMemo(
    () =>
      events.map((ev) => {
        const ledgerIncome = entries
          .filter((e) => e.eventId === ev.id && e.kind === "income")
          .reduce((s, e) => s + e.amount, 0);
        const ledgerExpense = entries
          .filter((e) => e.eventId === ev.id && e.kind === "expense")
          .reduce((s, e) => s + e.amount, 0);

        const income =
          ledgerIncome ||
          ev.money.collected ||
          ev.money.invoiced ||
          ev.money.agreedRevenue ||
          0;
        const expense = ledgerExpense || ev.money.actualCosts || ev.money.estimatedCosts || 0;

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
    const net = jobs.reduce((s, j) => s + j.net, 0);
    const frames = jobs.reduce((s, j) => s + j.frames, 0);
    return { hours, net, frames, perHour: hours > 0 ? net / hours : 0 };
  }, [jobs]);

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
      ...scheduleC.map((r) => [r.line.replace(".1", "a").replace(".2", "b"), r.label.replace(/,/g, ";"), r.amount.toFixed(2)]),
      ["28", "Total expenses", totals.expense.toFixed(2)],
      ["31", "Net profit or (loss)", totals.net.toFixed(2)],
    ]);

  const export1099 = () =>
    download(`lensos-1099-${new Date().getFullYear()}.csv`, [
      ["direction", "party", "amount_usd", "threshold_600"],
      ...payers.map((p) => ["income received", p.name.replace(/,/g, ";"), p.total.toFixed(2), p.total >= 600 ? "yes" : "no"]),
      ...payees.map((p) => ["contractor paid", p.name.replace(/,/g, ";"), p.total.toFixed(2), p.total >= 600 ? "yes" : "no"]),
    ]);


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
                  <td
                    className={`p-3 text-right font-mono ${j.net < 0 ? "text-rust" : ""}`}
                  >
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
                      {j.deadline ? `due ${j.deadline.at} · ${j.deadline.label}` : "no deadline set"}
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
              <div key={row.line} className="flex justify-between border-b border-border py-1.5 text-[13px]">
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
              Lines shown carry a balance. Meals are reported at the 50% deductible amount on
              line 24b. This is your ledger mapped to the form — not filed advice.
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
              <div key={p.name} className="flex items-center justify-between border-b border-border py-2 text-[13px]">
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
              <div key={p.name} className="flex items-center justify-between border-b border-border py-2 text-[13px]">
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

