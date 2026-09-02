import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ThemeToggle } from "@/components/lensos/Theme";
import { Footer } from "@/components/lensos/Footer";
import { LogoMark } from "@/components/lensos/Logo";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "LensOS Pricing — Same-Night Turnaround Plans" },
      {
        name: "description",
        content:
          "LensOS pricing for working photographers: Hobby $16/mo, Individual from $16/mo yearly, Teams per user, Enterprise custom. Import, Pick, Adobe, Send.",
      },
      { property: "og:title", content: "LensOS Pricing — Same-Night Turnaround Plans" },
      {
        property: "og:description",
        content:
          "Plans for sports, event and wedding shooters. Pick, hand off to Adobe, send the gallery tonight.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Cycle = "monthly" | "yearly";

const IND_TIERS = [
  { id: "starter", label: "Starter", monthly: 20, yearly: 16, cta: "Get Starter" },
  { id: "sideline", label: "Sideline", monthly: 60, yearly: 48, cta: "Get Sideline" },
  { id: "arena", label: "Arena", monthly: 200, yearly: 160, cta: "Get Arena" },
];

const TEAM_TIERS = [
  { id: "crew", label: "Crew", monthly: 40, yearly: 32, cta: "Get Crew" },
  { id: "agency", label: "Agency", monthly: 80, yearly: 64, cta: "Get Agency" },
];

const FAQ = [
  ["Do I have to leave Lightroom?", "No. Keepers go to Adobe. Craft stays there."],
  ["Is reject a delete?", "No. Soft reject only."],
  ["What counts as a photo?", "A frame ingested into a job this billing period."],
  ["Can I send a gallery the same night?", "Yes. That is the point."],
  [
    "What happens if I go over Hobby's 100?",
    "Upgrade, or wait for the next month. Nothing extra is billed per photo.",
  ],
];

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 flex-1 space-y-2 text-sm text-moss">
      {items.map((f) => (
        <li key={f} className="flex gap-2">
          <span className="text-rust">·</span>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

function TierSwitch({
  tiers,
  value,
  onChange,
}: {
  tiers: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mt-4 flex overflow-hidden rounded-xl border border-input">
      {tiers.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 px-2 py-1.5 text-[13px] transition-colors ${
            value === t.id ? "bg-ink text-paper2" : "text-moss hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const ctaBase =
  "mt-7 block rounded-xl py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-85";

function PricingPage() {
  const [cycle, setCycle] = useState<Cycle>("yearly");
  const [ind, setInd] = useState("starter");
  const [team, setTeam] = useState("crew");

  const yearly = cycle === "yearly";
  const indTier = IND_TIERS.find((t) => t.id === ind)!;
  const teamTier = TEAM_TIERS.find((t) => t.id === team)!;
  const indPrice = yearly ? indTier.yearly : indTier.monthly;
  const teamPrice = yearly ? teamTier.yearly : teamTier.monthly;

  return (
    <div className="flex min-h-screen w-full flex-col text-ink">
      {/* top nav */}
      <div className="sticky top-4 z-50 px-4">
        <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark className="text-ink" />
            <span className="font-display text-[15px] font-semibold tracking-tight">LensOS</span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm text-moss sm:flex">
            <Link to="/" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
              Product
            </Link>
            <span className="rounded-lg bg-muted px-3 py-1.5 text-ink">Pricing</span>
            <a href="#download" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
              Sign in
            </a>
            <a href="#volume" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
              Contact sales
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href="#download"
              className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
            >
              Download
            </a>
          </div>
        </header>
      </div>

      <section className="mx-auto w-full max-w-[1240px] flex-1 px-6 pb-24 pt-16">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
            Import → Pick → Adobe → Send
          </p>
          <h1 className="mx-auto mt-4 max-w-[780px] font-display text-[clamp(2.1rem,5vw,3.4rem)] font-bold leading-[1.05] tracking-[-0.04em]">
            Same-night turnaround. Pick, hand off to Adobe, send.
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-[15px] text-moss">
            You shoot and edit. LensOS owns the volume decisions and the client send.
          </p>

          {/* billing toggle */}
          <div className="mt-8 inline-flex overflow-hidden rounded-xl border border-input">
            {(["monthly", "yearly"] as Cycle[]).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`px-4 py-2 text-[13px] capitalize transition-colors ${
                  cycle === c ? "bg-ink text-paper2" : "text-moss hover:text-ink"
                }`}
              >
                {c}
                {c === "yearly" && <span className="ml-1 text-[11px]">· save 20%</span>}
              </button>
            ))}
          </div>
        </div>

        {/* plan cards */}
        <div className="mt-12 grid items-stretch gap-4 text-left lg:grid-cols-4">
          {/* Hobby */}
          <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
            <span className="font-display text-sm font-semibold">Hobby</span>
            <p className="mt-1 text-[13px] text-moss">100 photos/month included.</p>
            <div className="mt-3 font-display text-4xl font-bold tracking-[-0.03em]">
              $16
              <small className="ml-1 text-sm font-normal text-moss">/ mo</small>
            </div>
            <p className="mt-1 text-[12px] text-moss">Same rate monthly or yearly.</p>
            <Bullets
              items={[
                "100 photos per month",
                "Automatic duplicate / stack sorting",
                "Basic keeper recommendations",
              ]}
            />
            <a href="#download" className={`${ctaBase} border border-input text-ink`}>
              Start Hobby
            </a>
          </div>

          {/* Individual */}
          <div className="flex flex-col rounded-2xl border border-ink/25 bg-card p-7 shadow-[0_10px_40px_rgba(0,0,0,0.07)]">
            <span className="font-display text-sm font-semibold">Individual</span>
            <p className="mt-1 text-[13px] text-moss">One shooter working a real schedule.</p>
            <div className="mt-3 font-display text-4xl font-bold tracking-[-0.03em]">
              ${indPrice}
              <small className="ml-1 text-sm font-normal text-moss">/ mo</small>
            </div>
            <p className="mt-1 text-[12px] text-moss">
              {yearly ? `Billed yearly · $${indTier.monthly}/mo monthly` : "Billed monthly"}
            </p>
            <TierSwitch tiers={IND_TIERS} value={ind} onChange={setInd} />
            <Bullets
              items={[
                "Everything in Hobby, plus:",
                "Higher culling limits",
                "Lightroom-ready keeper export / handoff",
                "Client gallery publish",
                "Client favorites back onto the job",
                "Parking-lot review — previews ready while ingest continues",
                "\u201cNeeds you\u201d queue for story frames the AI would kill",
              ]}
            />
            <a href="#download" className={`${ctaBase} bg-ink text-paper2`}>
              {indTier.cta}
            </a>
          </div>

          {/* Teams */}
          <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
            <span className="font-display text-sm font-semibold">Teams</span>
            <p className="mt-1 text-[13px] text-moss">Second shooter, editor, one bill.</p>
            <div className="mt-3 font-display text-4xl font-bold tracking-[-0.03em]">
              ${teamPrice}
              <small className="ml-1 text-sm font-normal text-moss">/user / mo</small>
            </div>
            <p className="mt-1 text-[12px] text-moss">
              {yearly ? `Billed yearly · $${teamTier.monthly}/user monthly` : "Billed monthly"}
            </p>
            <TierSwitch tiers={TEAM_TIERS} value={team} onChange={setTeam} />
            <Bullets
              items={[
                "Everything in Individual, plus:",
                "Centralized team billing",
                "Shared event workspaces",
                "Assistant / editor handoff",
                "Client approval before send",
                "Shared packages and receipts",
              ]}
            />
            <a href="#download" className={`${ctaBase} border border-input text-ink`}>
              {teamTier.cta}
            </a>
          </div>

          {/* Enterprise */}
          <div id="volume" className="flex flex-col rounded-2xl border border-border bg-card p-7">
            <span className="font-display text-sm font-semibold">Enterprise</span>
            <p className="mt-1 text-[13px] text-moss">Studio and league volume.</p>
            <div className="mt-3 font-display text-4xl font-bold tracking-[-0.03em]">Custom</div>
            <p className="mt-1 text-[12px] text-moss">Invoiced to your terms.</p>
            <Bullets
              items={[
                "Everything in Teams, plus:",
                "Pooled usage across studios",
                "Invoice / PO billing",
                "SSO and seat management",
                "Custom gallery destinations",
                "Dedicated workflow support",
              ]}
            />
            <a href="mailto:hello@tryiris.ai" className={`${ctaBase} border border-input text-ink`}>
              Contact sales
            </a>
          </div>
        </div>

        {/* who it's for */}
        <div className="mt-8 grid gap-3 rounded-2xl border border-border bg-card p-6 text-[13px] sm:grid-cols-4">
          {[
            ["Hobby", "testing the cull"],
            ["Individual", "one shooter, Friday night recap"],
            ["Teams", "second shooter + editor"],
            ["Enterprise", "studio / league volume"],
          ].map(([k, v]) => (
            <p key={k}>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                {k}
              </span>
              <br />
              <span className="text-moss">{v}</span>
            </p>
          ))}
        </div>

        {/* comparison notes */}
        <div className="mt-4 grid gap-3 text-[13px] text-moss md:grid-cols-3">
          {[
            [
              "Volume, not per photo",
              "Hobby caps at 100 frames a month. Individual raises the cull limit as your season gets heavier. Teams prices per user.",
            ],
            [
              "Where Adobe sits",
              "Keepers hand off to Lightroom and Photoshop. LensOS does not replace them — it decides volume and runs the send.",
            ],
            [
              "What upgrading actually adds",
              "Individual adds galleries and the needs-you queue. Teams adds shared workspaces and an approval gate. Enterprise pools usage and adds SSO.",
            ],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">{k}</p>
              <p className="mt-2">{v}</p>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="mt-14">
          <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">Questions</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {FAQ.map(([q, a]) => (
              <div key={q} className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm font-semibold">{q}</p>
                <p className="mt-1.5 text-[13px] text-moss">{a}</p>
              </div>
            ))}
          </div>
        </div>

        <div
          id="download"
          className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-7"
        >
          <div>
            <p className="font-display text-lg font-semibold tracking-tight">
              Your turnaround date is tonight.
            </p>
            <p className="text-[13px] text-moss">Import, pick, hand off, send.</p>
          </div>
          <div className="ml-auto flex gap-2">
            <a
              href="#download"
              className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 hover:opacity-85"
            >
              Download
            </a>
            <a
              href="mailto:hello@tryiris.ai"
              className="rounded-xl border border-input px-4 py-2 text-sm font-medium hover:opacity-85"
            >
              Contact sales
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
