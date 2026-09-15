import { Link } from "@tanstack/react-router";

const COLUMNS: { title: string; links: { label: string; to?: string; href?: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Event Desk", to: "/desk" },
      { label: "Pick", to: "/pick" },
      { label: "Metadata", to: "/metadata" },
      { label: "Packages", to: "/packages" },
      { label: "Pricing", to: "/pricing" },
      { label: "Security" },
    ],
  },
  {
    title: "Features",
    links: [
      { label: "Ingest" },
      { label: "Focus scoring" },
      { label: "Face + eye flags" },
      { label: "Adobe handoff", to: "/adobe" },
      { label: "Delivery", to: "/send" },
      { label: "Portfolio", to: "/portfolio" },
      { label: "Changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About" },
      { label: "Photographers" },
      { label: "Campus ambassadors", to: "/ambassador" },
      { label: "Careers" },
      { label: "Method" },
      { label: "Quality" },
      { label: "Brand" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Switch from Pixieset" },
      { label: "Download" },
      { label: "Documentation" },
      { label: "Lightroom plugin", to: "/settings" },
      { label: "Status" },
      { label: "Studios" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "Contact sales", href: "mailto:hello@lenslab.dev" },
      { label: "Contact us" },
      { label: "Community" },
      { label: "X (Twitter)" },
      { label: "GitHub" },
      { label: "YouTube" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-[oklch(0.13_0.004_260)] text-[oklch(0.97_0.002_100)]">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-20">
        <div className="grid gap-10 md:grid-cols-[140px_repeat(5,1fr)]">
          <Link to="/" className="flex items-start">
            <span className="grid size-9 place-items-center rounded-full border border-current/25 font-display text-[15px] font-bold">
              ◐
            </span>
          </Link>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="font-display text-[15px] font-semibold tracking-tight">{col.title}</p>
              <ul className="mt-5 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href ? (
                      <a
                        href={l.href}
                        className="text-[14px] text-current/55 transition-colors hover:text-current"
                      >
                        {l.label}
                      </a>
                    ) : l.to ? (
                      <Link
                        to={l.to}
                        className="text-[14px] text-current/55 transition-colors hover:text-current"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      <span className="cursor-default text-[14px] text-current/40">{l.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-20 flex flex-wrap items-center gap-6 text-[14px] text-current/45">
          <span>Privacy</span>
          <span>Terms</span>
          <span>DPA</span>
          <span>AUP</span>
          <span className="ml-auto font-mono text-[12px] text-current/35">
            LensLabs · originals read-only · nothing sends without approval
          </span>
        </div>
      </div>
    </footer>
  );
}
