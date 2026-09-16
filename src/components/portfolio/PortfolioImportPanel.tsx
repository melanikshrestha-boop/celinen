import { useLayoutEffect, useRef, useState } from "react";
import {
  parsePortfolioImport,
  PORTFOLIO_IMPORT_MAX_BYTES,
  serializePortfolioImport,
  type PortfolioImportContent,
  type PortfolioImportPlan,
} from "@/lib/portfolio-import";

const fields = [
  ["name", "Site Name"],
  ["hero", "Headline"],
  ["bio", "Description"],
  ["nav", "Navigation Labels"],
] as const;
type Field = (typeof fields)[number][0];

/** In-memory preflight only; the parent merges reviewed text into empty editor fields. */
export function PortfolioImportPanel({
  onApply,
}: {
  onApply: (content: PortfolioImportContent) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [owned, setOwned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState<PortfolioImportPlan | null>(null);
  const [selected, setSelected] = useState<Field[]>([]);
  const generation = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
  useLayoutEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const readFile = async (file: File) => {
    if (!owned) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    setPlan(null);
    setSelected([]);
    try {
      if (file.size > PORTFOLIO_IMPORT_MAX_BYTES)
        throw new Error("Choose a file no larger than 2 MiB.");
      const text = await file.text();
      if (request !== generation.current) return;
      const next = parsePortfolioImport(text, { fileName: file.name, sourceUrl });
      setPlan(next);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const cancel = () => {
    generation.current++;
    setBusy(false);
    setPlan(null);
    setError("");
    setNotice("");
    setSelected([]);
    if (chooser.current) chooser.current.value = "";
  };
  const download = () => {
    if (!plan) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([serializePortfolioImport(plan)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "foto-migration-plan.json";
      document.body.append(link);
      link.click();
      link.remove();
      const release = url;
      window.setTimeout(() => URL.revokeObjectURL(release), 1000);
      setNotice("Plan download requested. Photos and editor changes are not included.");
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      setError(e instanceof Error ? e.message : "Could not download the plan.");
    }
  };
  return (
    <section className="space-y-3" aria-label="Website import" aria-busy={busy}>
      <h2 className="text-lg font-semibold">Bring Your Website Content</h2>
      <p className="text-sm text-moss">Review saved page text or Pixieset collection metadata.</p>
      <p className="text-xs text-moss">
        Session preview only. Not saved, published, or an ownership transfer.
      </p>
      <label className="block space-y-1 text-sm">
        <span>
          Original Website Address <span className="text-moss">(optional)</span>
        </span>
        <input
          className="w-full rounded-lg border border-input bg-card px-3 py-2"
          type="text"
          inputMode="url"
          value={sourceUrl}
          disabled={busy || !!plan}
          placeholder="yourname.mypixieset.com"
          onChange={(e) => setSourceUrl(e.target.value)}
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={owned}
          disabled={busy}
          onChange={(e) => {
            setOwned(e.target.checked);
            if (!e.target.checked) cancel();
          }}
          className="mt-1"
        />
        <span>I own this content or have permission to copy it into Celinen.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <label
          className={`inline-flex cursor-pointer rounded-lg border border-input px-3 py-2 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${!owned || busy ? "opacity-50" : "hover:bg-muted"}`}
        >
          Choose Import File
          <input
            ref={chooser}
            className="sr-only"
            type="file"
            accept=".html,.htm,.csv,.json"
            disabled={!owned || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readFile(file);
            }}
          />
        </label>
        {(busy || plan) && (
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm hover:bg-muted"
            onClick={cancel}
          >
            {busy ? "Cancel Read" : "Clear Preview"}
          </button>
        )}
      </div>
      {busy && (
        <p role="status" className="text-sm">
          Reading file…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {plan && (
        <div className="space-y-3 rounded-lg bg-muted/30 p-3" aria-label="Import preview">
          <h3 className="font-medium">Review: {plan.source.fileName}</h3>
          {plan.source.url && (
            <p className="break-all text-xs text-moss">Source: {plan.source.url}</p>
          )}
          {fields.map(([key, label]) => {
            const value = plan.content[key];
            const preview = Array.isArray(value) ? value.join(" · ") : value;
            if (!preview) return null;
            return (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(key)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, key] : old.filter((f) => f !== key),
                    )
                  }
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="whitespace-pre-wrap break-words text-moss">{preview}</span>
                </span>
              </label>
            );
          })}
          {plan.collections.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">
                {plan.collections.length} collection records — planning only
              </summary>
              <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-sm">
                {plan.collections.map((collection, i) => (
                  <li key={i}>
                    <span className="block">{collection.name}</span>
                    {collection.url && (
                      <span className="block break-all text-xs text-moss">{collection.url}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="text-xs text-moss">
            <summary className="cursor-pointer">Import Notes</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {plan.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </details>
          <p className="text-xs text-moss">
            Selected text fills blank fields only. Your edits, theme and photos stay unchanged.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-ink px-3 py-2 text-sm text-paper2 disabled:opacity-40"
              disabled={!owned || selected.length === 0}
              onClick={() => {
                try {
                  onApply({
                    name: selected.includes("name") ? plan.content.name : "",
                    bio: selected.includes("bio") ? plan.content.bio : "",
                    hero: selected.includes("hero") ? plan.content.hero : "",
                    nav: selected.includes("nav") ? plan.content.nav : [],
                  });
                  setNotice(
                    "Applied to blank fields only. Existing edits kept; preview not saved.",
                  );
                  setSelected([]);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not apply the selected text.");
                }
              }}
            >
              Fill Blank Fields
            </button>
            <button
              type="button"
              className="rounded-lg border border-input px-3 py-2 text-sm"
              onClick={download}
            >
              Download Migration Plan
            </button>
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">What Can Be Imported</summary>
        <div className="mt-2 space-y-2 text-xs text-moss">
          <p>
            HTML: text from one saved page. Pixieset folder CSV: collection names and links only.
            JSON: Celinen migration plan v1. Maximum 2 MiB / 1,000 collections.
          </p>
          <p>
            No photos, video, styling, fonts, working navigation, forms or scripts are imported.
            ZIP, XML, themes and full-site backups are unsupported. CSV contact details, passwords
            and PINs are discarded; collection records do not create galleries or clients.
          </p>
          <p>
            Website addresses are source notes, not proof of ownership. They are not opened or
            verified; query strings and fragments are removed. No live-site scraping or photo
            downloads occur.
          </p>
          <p>
            A downloaded plan contains parsed text and collection metadata, not your photos, later
            editor changes, or a complete website backup. Keep your original files.
          </p>
          <p>
            Your old site stays untouched. No domain, account, billing, hosting, SEO, gallery or
            ownership transfer occurs. DNS and email records remain unchanged. Keep the old site
            live until a separate publishing and redirect plan is tested.
          </p>
          <p>
            <a
              className="underline"
              href="https://help.pixieset.com/hc/en-us/articles/31178129650957-Using-folders-to-share-and-organize-galleries"
              target="_blank"
              rel="noreferrer"
            >
              Pixieset Export Guide
            </a>{" "}
            ·{" "}
            <a
              className="underline"
              href="https://help.pixieset.com/hc/en-us/articles/360059864271-All-you-need-to-know-about-Domains"
              target="_blank"
              rel="noreferrer"
            >
              Pixieset Domain Guide
            </a>
          </p>
        </div>
      </details>
    </section>
  );
}
