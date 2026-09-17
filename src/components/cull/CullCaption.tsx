import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { CullCodes } from "@/lib/studio/cull/controller";
import { expandTyped } from "./cull-review";

export type CullCodesInput = {
  name: string;
  kind: "codes" | "roster";
  prefix?: string | undefined;
  text: string;
};

/**
 * The caption field. Codes expand as they are typed; Enter saves, Shift+Enter
 * breaks the line, Esc puts back what was saved. With several frames selected
 * it captions all of them.
 */
export function CullCaption({
  value,
  count,
  codes,
  onCommit,
  inline = false,
}: {
  /** The saved caption, or "" when the frames have none or different ones. */
  value: string;
  /** Frames the caption applies to. */
  count: number;
  codes: CullCodes;
  /** One line beside other controls, for a selection. */
  inline?: boolean | undefined;
  onCommit: (caption: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [unknown, setUnknown] = useState<string[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  // A new saved value (another frame, an undo) replaces a draft that was not being edited.
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value);
    setUnknown([]);
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const element = event.target;
    const next = expandTyped(
      element.value,
      element.selectionStart ?? element.value.length,
      codes.table,
    );
    setDraft(next.text);
    setUnknown(next.unknown);
    if (next.text !== element.value)
      // After React writes the expanded text, put the caret after the expansion.
      requestAnimationFrame(() => field.current?.setSelectionRange(next.caret, next.caret));
  };
  const commit = () => {
    if (draft !== value) onCommit(draft.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commit();
      field.current?.blur();
    } else if (event.key === "Escape") {
      // Esc here belongs to the field, not the loupe behind it.
      event.preventDefault();
      event.stopPropagation();
      setDraft(value);
      setUnknown([]);
      field.current?.blur();
    }
  };

  return (
    <div className="cull-caption" data-inline={inline || undefined}>
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-wider text-moss">
        {count > 1 && !inline ? `Caption · ${count}` : "Caption"}
      </label>
      <textarea
        ref={field}
        id={id}
        rows={inline ? 1 : 3}
        value={draft}
        spellCheck
        onChange={onChange}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {unknown.length > 0 && (
        <p className="font-mono text-[10px] text-rust" role="status">
          {`Unknown ${unknown.map((code) => `\\${code}\\`).join(" ")}`}
        </p>
      )}
    </div>
  );
}

/** The account's caption code sources: a Photo Mechanic code file or a roster CSV with its prefix. */
export function CullCodeSources({
  codes,
  onAdd,
  onRemove,
}: {
  codes: CullCodes;
  onAdd: (input: CullCodesInput) => Promise<unknown>;
  onRemove: (id: string) => void;
}) {
  const [prefix, setPrefix] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeFile = useRef<HTMLInputElement>(null);
  const rosterFile = useRef<HTMLInputElement>(null);
  const total = codes.table.codes.size;

  const load = async (event: ChangeEvent<HTMLInputElement>, kind: "codes" | "roster") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      await onAdd({ name: file.name, kind, prefix, text: await file.text() });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="cull-codes">
      <summary className="font-mono text-[10px] uppercase tracking-wider text-moss">
        {total ? `Codes · ${total.toLocaleString("en-US")}` : "Codes"}
      </summary>
      <div className="mt-2 grid gap-2 font-mono text-[11px]">
        {codes.sources.map((source) => (
          <div key={source.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={source.name}>
              {source.kind === "roster" && source.prefix ? `${source.prefix} · ` : ""}
              {source.name}
            </span>
            <span className="text-moss">{source.count}</span>
            <button
              type="button"
              className="grid size-6 place-items-center rounded-md hover:bg-ink/5"
              aria-label={`Remove ${source.name}`}
              onClick={() => onRemove(source.id)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="rounded-md border border-input px-2 py-1 hover:bg-ink/5 disabled:opacity-50"
            disabled={busy}
            onClick={() => codeFile.current?.click()}
          >
            Code file
          </button>
          <input
            className="w-14 rounded-md border border-input bg-transparent px-2 py-1"
            aria-label="Roster prefix"
            placeholder="Prefix"
            value={prefix}
            maxLength={8}
            onChange={(event) => setPrefix(event.target.value.replace(/[\s\\]/g, ""))}
          />
          <button
            type="button"
            className="rounded-md border border-input px-2 py-1 hover:bg-ink/5 disabled:opacity-50"
            disabled={busy}
            onClick={() => rosterFile.current?.click()}
          >
            Roster
          </button>
        </div>
        {problem && (
          <p role="alert" className="text-rust">
            {problem}
          </p>
        )}
        <input
          ref={codeFile}
          type="file"
          hidden
          accept=".txt,.tsv,text/plain,text/tab-separated-values"
          onChange={(event) => void load(event, "codes")}
        />
        <input
          ref={rosterFile}
          type="file"
          hidden
          accept=".csv,text/csv"
          onChange={(event) => void load(event, "roster")}
        />
      </div>
    </details>
  );
}
