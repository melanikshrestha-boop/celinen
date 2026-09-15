import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Btn, Card, SectionTitle, Shell } from "@/components/lensos/Shell";
import type { ImportedTheme } from "@/lib/portfolio-import.functions";
import { useAccount } from "@/components/account/AccountProvider";
import { PortfolioImportPanel } from "@/components/portfolio/PortfolioImportPanel";
import { fillEmptyPortfolioFields, type PortfolioImportContent } from "@/lib/portfolio-import";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio Import — Celinen" },
      {
        name: "description",
        content:
          "Review saved website text and Pixieset collection metadata before adding content to a FOTO portfolio preview. Your existing website stays untouched.",
      },
      { property: "og:title", content: "Bring your website content — Celinen" },
      {
        property: "og:description",
        content: "File-based content review. No automatic domain transfer or website publishing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Portfolio,
});

interface Item {
  id: string;
  url: string;
  title: string;
  story: string;
}

const DEFAULT_THEME: ImportedTheme = {
  bg: "#ffffff",
  ink: "#141414",
  accent: null,
  headingFont: "",
  bodyFont: "",
  serif: false,
  uppercaseNav: false,
  layout: "stack",
};

const fontStack = (name: string, serif: boolean) =>
  `${name ? `"${name}", ` : ""}${serif ? "Georgia, 'Times New Roman', serif" : "var(--font-sans)"}`;

function Portfolio() {
  const account = useAccount();
  return <PortfolioEditor key={account?.scope ?? "signed-out"} />;
}

function PortfolioEditor() {
  const [items, setItems] = useState<Item[]>([]);
  const [handle, setHandle] = useState("");
  const [content, setContent] = useState<PortfolioImportContent>({
    name: "",
    bio: "",
    hero: "",
    nav: [],
  });
  const { name, bio, hero, nav } = content;
  const setName = (name: string) => setContent((old) => ({ ...old, name }));
  const setBio = (bio: string) => setContent((old) => ({ ...old, bio }));
  const setHero = (hero: string) => setContent((old) => ({ ...old, hero }));
  const [theme, setTheme] = useState<ImportedTheme>(DEFAULT_THEME);
  const [live, setLive] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (files: FileList | null) => {
    if (!files) return;
    const next: Item[] = [];
    Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f) => {
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        next.push({
          id: `${f.name}-${Math.random().toString(36).slice(2, 7)}`,
          url,
          title: f.name.replace(/\.[^.]+$/, ""),
          story: "",
        });
      });
    setItems((prev) => [...prev, ...next]);
  };

  const patch = (id: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const slug = (handle || name || "your-name")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const headingStyle = { fontFamily: fontStack(theme.headingFont, theme.serif) };
  const bodyStyle = { fontFamily: fontStack(theme.bodyFont, false) };
  const galleryClass =
    theme.layout === "grid"
      ? "mt-8 grid grid-cols-2 gap-3"
      : theme.layout === "masonry"
        ? "mt-8 columns-2 gap-3 [&>figure]:mb-3 [&>figure]:break-inside-avoid"
        : "mt-8 space-y-8";

  return (
    <Shell hideEventHeader>
      <SectionTitle
        kicker="Portfolio"
        title="Your work. Your next website."
        sub="Bring over approved text. Keep your photos, edits and existing site."
      />

      <Card className="mb-4">
        <PortfolioImportPanel
          onApply={(proposed) =>
            setContent((current) => fillEmptyPortfolioFields(current, proposed))
          }
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <div className="space-y-4">
          <Card>
            <div className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust/50"
              />
              <input
                value={hero}
                onChange={(e) => setHero(e.target.value)}
                placeholder="Headline (from your old hero)"
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust/50"
              />
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A sentence about the work you make."
                rows={3}
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust/50"
              />
              <div className="flex items-center gap-2">
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="handle"
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 font-sans text-sm outline-none focus:border-rust/50"
                />
                <span className="text-[13px] text-moss">preview label</span>
              </div>
            </div>

            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
              <p className="font-sans text-[11px] uppercase tracking-wide text-moss">
                Preview Appearance
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px]">
                  Background
                  <input
                    type="color"
                    value={theme.bg}
                    onChange={(e) => setTheme({ ...theme, bg: e.target.value })}
                    className="size-7 cursor-pointer rounded border border-input bg-transparent"
                  />
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  Text
                  <input
                    type="color"
                    value={theme.ink}
                    onChange={(e) => setTheme({ ...theme, ink: e.target.value })}
                    className="size-7 cursor-pointer rounded border border-input bg-transparent"
                  />
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  Accent
                  <input
                    type="color"
                    value={theme.accent ?? theme.ink}
                    onChange={(e) => setTheme({ ...theme, accent: e.target.value })}
                    className="size-7 cursor-pointer rounded border border-input bg-transparent"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {(["stack", "grid", "masonry"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setTheme({ ...theme, layout: l })}
                    className={`rounded-lg border px-2.5 py-1 font-sans text-[11px] ${
                      theme.layout === l ? "border-rust text-rust" : "border-input text-moss"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {theme.headingFont && (
                <p className="font-sans text-[11px] text-moss">
                  detected type: {theme.headingFont}
                  {theme.bodyFont && theme.bodyFont !== theme.headingFont
                    ? ` / ${theme.bodyFont}`
                    : ""}
                </p>
              )}
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                add(e.dataTransfer.files);
              }}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  input.current?.click();
                }
              }}
              className="mt-4 cursor-pointer rounded-xl border border-dashed border-input p-8 text-center transition-colors hover:border-rust/50"
            >
              <p className="text-sm">Drop photos here, or click to choose</p>
              <p className="mt-1 font-sans text-[11px] text-moss">
                JPEG / PNG / WebP · stays in your browser
              </p>
              <input
                ref={input}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => add(e.target.files)}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Btn variant="primary" disabled={!items.length} onClick={() => setLive(true)}>
                Preview Layout
              </Btn>
              {live && (
                <span className="text-sm text-moss">
                  Preview only ·{" "}
                  <a href="/publish" className="underline">
                    Publish Approved Finals
                  </a>
                </span>
              )}
            </div>
          </Card>

          {items.map((i) => (
            <Card key={i.id}>
              <div className="flex gap-3">
                <img src={i.url} alt={i.title} className="size-20 rounded-lg object-cover" />
                <div className="flex-1 space-y-2">
                  <input
                    value={i.title}
                    onChange={(e) => patch(i.id, { title: e.target.value })}
                    className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none"
                  />
                  <textarea
                    value={i.story}
                    onChange={(e) => patch(i.id, { story: e.target.value })}
                    placeholder="Write about this frame."
                    rows={2}
                    className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none"
                  />
                </div>
                <button
                  onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))}
                  className="self-start text-[12px] text-moss hover:text-ink"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="size-2 rounded-full bg-border" />
            <span className="text-[11px] text-moss">
              {slug} · layout preview, no domain assigned
            </span>
          </div>
          <div className="p-8" style={{ background: theme.bg, color: theme.ink, ...bodyStyle }}>
            {nav.length > 0 && (
              <nav
                className={`mb-8 flex flex-wrap gap-4 text-[12px] opacity-70 ${
                  theme.uppercaseNav ? "uppercase tracking-[0.14em]" : ""
                }`}
              >
                {nav.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </nav>
            )}

            <h2 className="text-4xl font-semibold tracking-tight" style={headingStyle}>
              {hero || name || "Your name"}
            </h2>
            {name && hero && hero !== name && (
              <p className="mt-1 text-[13px] opacity-60" style={headingStyle}>
                {name}
              </p>
            )}
            <p className="mt-2 max-w-md text-[15px] opacity-75">
              {bio || "A sentence about the work you make."}
            </p>
            <span
              className="mt-4 inline-block rounded-full px-4 py-1.5 text-[13px]"
              style={{ background: theme.accent ?? theme.ink, color: theme.bg }}
            >
              Get in touch
            </span>

            {items.length === 0 ? (
              <div className="mt-8 rounded-xl border border-dashed p-10 text-center text-sm opacity-60">
                Your photos will appear here as you add them.
              </div>
            ) : (
              <div className={galleryClass}>
                {items.map((i) => (
                  <figure key={i.id}>
                    <img
                      src={i.url}
                      alt={i.title}
                      loading="lazy"
                      className="w-full rounded-xl object-cover"
                    />
                    <figcaption className="mt-2">
                      <p className="text-[16px] font-semibold tracking-tight" style={headingStyle}>
                        {i.title}
                      </p>
                      {i.story && <p className="text-[14px] opacity-70">{i.story}</p>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
