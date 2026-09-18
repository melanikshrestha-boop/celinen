import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CullExportRequest } from "@/lib/studio/cull/controller";
import { startZipDownload } from "@/lib/studio/cull/handoff/fs-access";
import { directoryTarget, zipTarget } from "@/lib/studio/cull/handoff/target";
import { validateTemplate } from "@/lib/studio/cull/handoff/template";
import type { HandoffReport } from "@/lib/studio/cull/handoff/types";
import { useDestination, type CullDestination } from "./use-destination";

/** What the photographer is sending. */
export type CullExportScope = "keepers" | "selection" | "filter";

export type CullExportCounts = Record<CullExportScope, number>;

const SCOPES: readonly [CullExportScope, string][] = [
  ["keepers", "Keepers"],
  ["selection", "Selection"],
  ["filter", "Filter"],
];

const number = (value: number) => value.toLocaleString("en-US");

/** A folder button that says where the copies go, or the zip this browser falls back to. */
export function CullDestinationButton({
  destination,
  label,
}: {
  destination: CullDestination;
  label: string;
}) {
  // Safari and Firefox cannot write into a folder; there the copies download as one zip.
  if (destination.support.kind === "zip") return <span className="text-moss">Zip</span>;
  if (destination.locked)
    return (
      <button
        type="button"
        className="rounded-md border border-input px-2.5 py-1.5 hover:bg-ink/5"
        onClick={() => void destination.unlock()}
      >
        {`Allow ${destination.name}`}
      </button>
    );
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className="rounded-md border border-input px-2.5 py-1.5 hover:bg-ink/5"
        onClick={() => void destination.choose()}
      >
        {destination.name || label}
      </button>
      {destination.handle && (
        <button
          type="button"
          className="grid size-6 place-items-center rounded-md text-moss hover:bg-ink/5 hover:text-ink"
          aria-label={`Forget ${destination.name}`}
          onClick={destination.forget}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

type Run =
  | { state: "idle" }
  | { state: "preparing"; found: number; total: number }
  | { state: "copying"; files: number; totalFiles: number; bytes: number; totalBytes: number }
  | { state: "done"; report: HandoffReport }
  | { state: "failed"; message: string };

/**
 * Sends the keepers (or the selection, or everything the filter shows) to a
 * folder this browser remembers, or as one zip where folders are unavailable.
 */
export function CullExportPanel({
  counts,
  shootName,
  ids,
  onExport,
}: {
  counts: CullExportCounts;
  shootName: string;
  /** The frame ids behind the selection and filter scopes. */
  ids: (scope: CullExportScope) => readonly string[] | undefined;
  onExport: (request: CullExportRequest) => Promise<HandoffReport>;
}) {
  const destination = useDestination("celinen-export");
  const [scope, setScope] = useState<CullExportScope>("keepers");
  const [template, setTemplate] = useState("{filename}");
  const [sidecars, setSidecars] = useState(true);
  const [run, setRun] = useState<Run>({ state: "idle" });
  const abort = useRef<AbortController | null>(null);
  const templateProblem = validateTemplate(template);
  const busy = run.state === "preparing" || run.state === "copying";
  const chosen = scope === "keepers" ? undefined : ids(scope);
  const total = counts[scope];

  const start = useCallback(async () => {
    const controller = new AbortController();
    abort.current = controller;
    setRun({ state: "preparing", found: 0, total: 0 });
    const zip =
      destination.handle && !destination.locked
        ? null
        : await startZipDownload(`${shootName || "Keepers"}.zip`).catch(() => null);
    if (!zip && !destination.handle) {
      setRun({ state: "failed", message: "There is nowhere to write the copies." });
      return;
    }
    try {
      const report = await onExport({
        target: zip ? zipTarget(zip.writer) : directoryTarget(destination.handle!),
        ...(chosen ? { ids: chosen } : {}),
        renameTemplate: template,
        sidecars,
        signal: controller.signal,
        onPrepare: (found, count) => setRun({ state: "preparing", found, total: count }),
        onProgress: (progress) =>
          setRun({
            state: "copying",
            files: progress.files,
            totalFiles: progress.totalFiles,
            bytes: progress.bytes,
            totalBytes: progress.totalBytes,
          }),
      });
      // A cancelled zip is a truncated archive; it is thrown away, not saved.
      if (zip) {
        if (report.cancelled) await zip.cancel();
        else await zip.save();
      }
      setRun({ state: "done", report });
    } catch (error) {
      if (zip) await zip.cancel().catch(() => {});
      setRun({
        state: "failed",
        message: error instanceof Error ? error.message : "The export stopped.",
      });
    } finally {
      abort.current = null;
    }
  }, [destination.handle, destination.locked, shootName, onExport, chosen, template, sidecars]);

  return (
    <details className="cull-export relative">
      <summary className="cursor-pointer list-none rounded-md px-2.5 py-1.5 text-moss transition-colors hover:bg-ink/5 hover:text-ink [&::-webkit-details-marker]:hidden">
        Export
      </summary>
      <div className="absolute right-0 z-40 mt-1.5 w-80 rounded-lg border border-border bg-paper2 p-3 shadow-xl">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={scope === key}
              disabled={!counts[key]}
              onClick={() => setScope(key)}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                scope === key
                  ? "bg-ink text-paper2"
                  : "border border-input enabled:hover:bg-ink enabled:hover:text-paper2"
              }`}
            >
              {`${label} ${number(counts[key])}`}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <CullDestinationButton destination={destination} label="Choose folder" />
          <button
            type="button"
            aria-pressed={sidecars}
            onClick={() => setSidecars((value) => !value)}
            className={`ml-auto rounded-md px-2.5 py-1.5 ${sidecars ? "bg-ink/10 text-ink" : "text-moss hover:bg-ink/5"}`}
          >
            XMP
          </button>
        </div>

        <label className="mt-3 block">
          <span className="sr-only">File name template</span>
          <input
            className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-[11px]"
            value={template}
            spellCheck={false}
            aria-invalid={templateProblem ? true : undefined}
            onChange={(event) => setTemplate(event.target.value)}
          />
        </label>
        {templateProblem && (
          <p role="alert" className="mt-1 text-[10px] text-rust">
            {templateProblem}
          </p>
        )}
        {destination.problem && (
          <p role="alert" className="mt-1 text-[10px] text-rust">
            {destination.problem}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            className="rounded-md bg-ink px-3 py-1.5 text-paper2 transition-colors hover:bg-rust disabled:opacity-50"
            disabled={busy || !total || Boolean(templateProblem) || !destination.ready}
            onClick={() => void start()}
          >
            {`Export ${number(total)}`}
          </button>
          {busy && (
            <>
              <span role="status" className="text-moss">
                {run.state === "preparing"
                  ? `${number(run.found)} of ${number(run.total)}`
                  : `${number(run.files)} of ${number(run.totalFiles)}`}
              </span>
              <button
                type="button"
                className="ml-auto rounded-md px-2.5 py-1.5 text-moss hover:bg-ink/5 hover:text-ink"
                onClick={() => abort.current?.abort()}
              >
                Cancel
              </button>
            </>
          )}
        </div>

        {run.state === "failed" && (
          <p role="alert" className="mt-2 text-[11px] text-rust">
            {run.message}
          </p>
        )}
        {run.state === "done" && <CullExportReport report={run.report} />}
      </div>
    </details>
  );
}

/** A second copy of the card, made while it is read. Folders only: a card
 * backup that lands in the downloads folder as a zip is not a backup. */
export function CullBackupControl({
  on,
  onToggle,
  primary,
  secondary,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  primary: CullDestination;
  secondary: CullDestination;
  disabled: boolean;
}) {
  if (primary.support.kind === "zip") return null;
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={onToggle}
        className={`rounded-md px-2.5 py-1.5 ${on ? "bg-ink/10 text-ink" : "text-moss hover:bg-ink/5"}`}
      >
        Back up
      </button>
      {on && (
        <>
          <CullDestinationButton destination={primary} label="Choose folder" />
          {primary.handle && <CullDestinationButton destination={secondary} label="Second copy" />}
        </>
      )}
    </span>
  );
}

/** What happened to every file, with the reasons that matter. */
export function CullExportReport({ report }: { report: HandoffReport }) {
  const problems = [
    ...report.failed,
    ...report.skipped.filter((entry) => entry.reason !== "exists"),
  ];
  return (
    <div className="mt-2 text-[11px]" role="status">
      <p className={report.cancelled ? "text-rust" : "text-ink"}>
        {report.cancelled
          ? `Cancelled · ${number(report.copied.length)} copied`
          : `${number(report.copied.length)} copied${report.skipped.length ? ` · ${number(report.skipped.length)} skipped` : ""}${report.failed.length ? ` · ${number(report.failed.length)} failed` : ""}`}
      </p>
      {problems.length > 0 && (
        <ul className="mt-1 max-h-32 overflow-y-auto text-[10px] text-moss">
          {problems.slice(0, 20).map((entry, index) => (
            <li key={`${entry.source}-${index}`} className="truncate" title={entry.reason}>
              {`${entry.source} — ${entry.reason}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
