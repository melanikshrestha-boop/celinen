import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CullChat, type ToolCall } from "@/components/studio/CullChat";
import { LogoMark } from "@/components/lensos/Logo";
import { bridgeEndpoint } from "@/lib/lightroom-plugin";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_EDITS,
  type Flag,
  type Shot,
  analyseBitmap,
  analyseFaces,
  autoRefine,
  baseName,
  buildXmpSidecar,
  decodeFile,
  exportShot,
  isDuplicatePair,
  isRawFile,
  scoreOf,
} from "@/lib/imaging";

export const Route = createFileRoute("/shoot")({
  head: () => ({
    meta: [
      { title: "Shoot bar — drop, cull, send to Lightroom | LensLabs" },
      {
        name: "description",
        content:
          "Drop a shoot anywhere on the page, let LensLabs auto-cull it to keepers, then send the picks to Lightroom as XMP sidecars. Talk to it in plain English.",
      },
      { property: "og:title", content: "LensLabs Shoot Bar" },
      {
        property: "og:description",
        content: "Drop photos anywhere. Auto-cull to keepers. Send to Lightroom with XMP.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShootPage,
});

type Filter = "all" | "keepers" | "flagged" | "rejected" | "todo";

const FLAG_LABEL: Record<Flag, string> = {
  soft: "soft",
  blur: "blurred",
  underexposed: "dark",
  overexposed: "blown",
  duplicate: "duplicate",
  "face-soft": "face soft",
  "eyes-closed": "eyes closed",
};

function ShootPage() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  /* ---------------- beta gate ---------------- */
  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      if (data.user) setAuthed(true);
      else void navigate({ to: "/auth", search: { next: "/shoot" }, replace: true });
    });
    return () => {
      alive = false;
    };
  }, [navigate]);

  /* ---------------- import ----------------
   * Parallel decode pool. Frames decode at a culling resolution (1280px long
   * edge) instead of full size, thumbnails go out as blob URLs, and results
   * stream into the grid as each worker finishes — a 300-frame drop lands in
   * a couple of seconds instead of a minute.
   */
  const importFiles = useCallback(async (files: File[]) => {
    files = files.filter((f) => !f.name.toLowerCase().endsWith(".xmp"));
    if (!files.length) return;

    const started = performance.now();
    setProgress({ done: 0, total: files.length });
    setNote(null);

    const stamp = Date.now();
    const added: Shot[] = new Array(files.length);
    let done = 0;

    const one = async (i: number) => {
      const file = files[i]!;
      const id = `${file.name}-${file.size}-${i}-${stamp}`;
      try {
        const bitmap = await decodeFile(file, 1280);
        const analysis = analyseBitmap(bitmap);
        const faces = await analyseFaces(bitmap);
        const { score, flags } = scoreOf({ ...analysis, faces });

        const s = Math.min(1, 420 / Math.max(bitmap.width, bitmap.height));
        const tw = Math.max(1, Math.round(bitmap.width * s));
        const th = Math.max(1, Math.round(bitmap.height * s));
        const thumb = document.createElement("canvas");
        thumb.width = tw;
        thumb.height = th;
        thumb.getContext("2d")!.drawImage(bitmap, 0, 0, tw, th);
        const blob = await new Promise<Blob | null>((res) =>
          thumb.toBlob(res, "image/jpeg", 0.72),
        );

        added[i] = {
          id,
          file,
          name: file.name,
          isRaw: isRawFile(file),
          previewUrl: blob ? URL.createObjectURL(blob) : null,
          width: bitmap.width,
          height: bitmap.height,
          sizeMb: file.size / 1_048_576,
          sharpness: analysis.sharpness,
          brightness: analysis.brightness,
          clippedHighlights: analysis.clippedHighlights,
          clippedShadows: analysis.clippedShadows,
          score,
          flags,
          hash: analysis.hash,
          tone: analysis.tone,
          faces: faces ?? undefined,
          verdict: "undecided",
          edits: { ...DEFAULT_EDITS },
        };
        bitmap.close?.();
      } catch (err) {
        added[i] = {
          id,
          file,
          name: file.name,
          isRaw: isRawFile(file),
          previewUrl: null,
          width: 0,
          height: 0,
          sizeMb: file.size / 1_048_576,
          sharpness: 0,
          brightness: 0,
          clippedHighlights: 0,
          clippedShadows: 0,
          score: 0,
          flags: [],
          hash: "",
          verdict: "undecided",
          edits: { ...DEFAULT_EDITS },
          error: (err as Error).message || "could not read this file",
        };
      }
      done++;
      setProgress({ done, total: files.length });
    };

    const lanes = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(lanes, files.length) }, async () => {
        while (cursor < files.length) await one(cursor++);
      }),
    );

    const shots = added.filter(Boolean);

    // duplicate pass across the whole shoot
    setShots((prev) => {
      const all = [...prev, ...shots];
      for (let i = 0; i < all.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = all[i]!;
          const b = all[j]!;
          if (!a.hash || !b.hash) continue;
          if (isDuplicatePair(a, b) && !a.flags.includes("duplicate")) {
            a.flags = [...a.flags, "duplicate"];
          }
        }
      }
      return all;
    });

    const secs = (performance.now() - started) / 1000;
    const rate = Math.round(shots.length / Math.max(secs, 0.001));
    setProgress(null);
    setNote(
      `${shots.length} frame${shots.length === 1 ? "" : "s"} read in ${secs.toFixed(1)}s · ${rate}/sec · ${lanes} lanes. say the word.`,
    );
  }, []);

  /* whole-page drop */
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void importFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [importFiles]);

  /* ---------------- actions ---------------- */
  const counts = useMemo(
    () => ({
      all: shots.length,
      keepers: shots.filter((s) => s.verdict === "keep").length,
      rejected: shots.filter((s) => s.verdict === "reject").length,
      flagged: shots.filter((s) => s.flags.length > 0).length,
      todo: shots.filter((s) => s.verdict === "undecided").length,
    }),
    [shots],
  );

  const visible = useMemo(() => {
    switch (filter) {
      case "keepers":
        return shots.filter((s) => s.verdict === "keep");
      case "rejected":
        return shots.filter((s) => s.verdict === "reject");
      case "flagged":
        return shots.filter((s) => s.flags.length > 0);
      case "todo":
        return shots.filter((s) => s.verdict === "undecided");
      default:
        return shots;
    }
  }, [shots, filter]);

  const autoCull = useCallback((minScore = 45, keepScore = 70) => {
    let kept = 0;
    let cut = 0;
    setShots((prev) =>
      prev.map((s) => {
        if (s.error) return s;
        const bad =
          s.flags.includes("blur") ||
          s.flags.includes("duplicate") ||
          s.flags.includes("eyes-closed") ||
          s.score < minScore;
        if (bad) cut++;
        else if (s.score >= keepScore) kept++;
        return { ...s, verdict: bad ? "reject" : s.score >= keepScore ? "keep" : s.verdict };
      }),
    );
    return { kept, cut };
  }, []);

  /** Write XMP sidecars locally AND publish the verdicts to the live Lightroom bridge. */
  const writeXmp = useCallback(async () => {
    const done = shots.filter((s) => s.verdict !== "undecided" && !s.error);
    if (!done.length) {
      setNote("Nothing decided yet — run Auto-cull first.");
      return 0;
    }

    const ratingOf = (s: Shot) =>
      s.verdict === "reject" ? 0 : Math.max(1, Math.min(5, Math.round(s.score / 20)));

    for (const shot of done) {
      const xml = buildXmpSidecar(shot.edits, shot.verdict, ratingOf(shot));
      const url = URL.createObjectURL(new Blob([xml], { type: "application/rdf+xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName(shot.name)}.xmp`;
      a.click();
      URL.revokeObjectURL(url);
    }

    let pushed = false;
    try {
      const res = await fetch(bridgeEndpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "verdicts",
          direction: "to-lightroom",
          frames: done.map((s) => ({
            file: s.name,
            verdict: s.verdict,
            score: s.score,
            rating: ratingOf(s),
            label: s.verdict === "keep" ? "Green" : "Red",
            develop: {
              exposure: s.edits.exposure / 20,
              contrast: s.edits.contrast,
              highlights: s.edits.highlights,
              shadows: s.edits.shadows,
              saturation: s.edits.saturation,
              temperature: Math.round(5500 + (s.edits.temp / 100) * 4500),
            },
          })),
        }),
      });
      pushed = res.ok;
    } catch {
      pushed = false;
    }

    setNote(
      pushed
        ? `${done.length} frames sent to Lightroom — sidecars downloaded, and verdicts queued on the bridge (Plug-in Extras → “Pull LensLabs verdicts”).`
        : `${done.length} XMP sidecar${done.length === 1 ? "" : "s"} written, but the LensLabs bridge was unreachable — drop them beside the negatives and hit “Read metadata from file” in Lightroom.`,
    );
    return done.length;
  }, [shots]);

  const exportKeepers = useCallback(async () => {
    const keepers = shots.filter((s) => s.verdict === "keep" && !s.error);
    for (const k of keepers) {
      const bmp = await decodeFile(k.file);
      await exportShot(bmp, k.edits, k.name, k.faces?.center ?? null);
      bmp.close?.();
      await new Promise((r) => setTimeout(r, 200));
    }
    setNote(`${keepers.length} keepers exported.`);
    return keepers.length;
  }, [shots]);

  /* ---------------- assistant bridge ---------------- */
  const chatContext = useMemo(() => {
    if (!shots.length) return "No shoot loaded yet. Use import_photos to open the picker.";
    const flagCount: Record<string, number> = {};
    for (const s of shots) for (const f of s.flags) flagCount[f] = (flagCount[f] ?? 0) + 1;
    return [
      `${counts.all} frames · ${counts.keepers} keepers · ${counts.rejected} rejected · ${counts.todo} undecided`,
      `flags: ${Object.entries(flagCount).map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`,
      `showing: ${filter}`,
    ].join("\n");
  }, [shots, counts, filter]);

  const executeTool = useCallback(
    async (call: ToolCall): Promise<string> => {
      const a = call.args;
      switch (call.name) {
        case "import_photos":
          inputRef.current?.click();
          return "file picker open";
        case "cull": {
          const { kept, cut } = autoCull(
            typeof a['min_score'] === "number" ? (a['min_score'] as number) : 45,
            typeof a['keep_score'] === "number" ? (a['keep_score'] as number) : 70,
          );
          return `culled — ${kept} kept, ${cut} rejected`;
        }
        case "keep_top": {
          const n = Math.max(0, Number(a['n'] ?? 0));
          const order = [...shots].filter((s) => !s.error).sort((x, y) => y.score - x.score);
          const keepIds = new Set(order.slice(0, n).map((s) => s.id));
          setShots((prev) =>
            prev.map((s) =>
              s.error ? s : { ...s, verdict: keepIds.has(s.id) ? "keep" : "reject" },
            ),
          );
          return `kept top ${keepIds.size}`;
        }
        case "reject_flagged": {
          const flags = (a['flags'] as Flag[]) ?? [];
          let n = 0;
          setShots((prev) =>
            prev.map((s) => {
              if (s.error || !s.flags.some((f) => flags.includes(f))) return s;
              n++;
              return { ...s, verdict: "reject" };
            }),
          );
          return `rejected ${n} flagged frames`;
        }
        case "set_filter":
          setFilter((a['filter'] as Filter) ?? "all");
          return `showing ${a['filter']}`;
        case "write_xmp":
          return `${writeXmp()} sidecars written for Lightroom`;
        case "export_keepers":
          return `${await exportKeepers()} keepers exported`;
        default:
          return "not available on the shoot bar — open the full studio for that";
      }
    },
    [shots, autoCull, writeXmp, exportKeepers],
  );

  if (authed === null) {
    return (
      <div className="grid min-h-screen place-items-center font-mono text-[12px] text-moss">
        checking access…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden text-ink">
      {/* ---------------- shoot bar ---------------- */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[14px] font-semibold tracking-tight">LensLabs</span>
        </Link>
        <span className="font-mono text-[11px] text-moss">
          {shots.length
            ? `${counts.all} frames · ${counts.keepers} keepers · ${counts.rejected} cut`
            : "no shoot loaded"}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {(["all", "todo", "keepers", "flagged", "rejected"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                filter === f ? "bg-ink text-paper2" : "text-moss hover:text-ink"
              }`}
            >
              {f} {counts[f]}
            </button>
          ))}
          <button
            onClick={() => (shots.length ? autoCull() : inputRef.current?.click())}
            className="ml-1 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-paper2 transition-opacity hover:opacity-85"
          >
            {shots.length ? "Auto-cull" : "Import"}
          </button>
          <button
            onClick={() => writeXmp()}
            disabled={!counts.keepers && !counts.rejected}
            className="rounded-lg border border-input px-3 py-1.5 text-[13px] transition-colors hover:bg-muted disabled:opacity-35"
          >
            Send to Lightroom
          </button>
          <button
            onClick={() => folderRef.current?.click()}
            className="rounded-lg border border-input px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
          >
            Folder
          </button>
        </div>
      </header>

      {note && (
        <div className="shrink-0 border-b border-border px-4 py-1.5 font-mono text-[11px] text-rust">
          {note}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.nef,.cr2,.cr3,.arw,.dng,.raf,.orf,.rw2,.pef,.srw"
        className="hidden"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        // @ts-expect-error non-standard directory picker attributes
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* ---------------- chat left · work right ---------------- */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col border-r border-border p-4 lg:flex">
          <CullChat context={chatContext} execute={executeTool} />
        </aside>

        <section className="min-h-0 overflow-y-auto p-5">
          {progress && (
            <div className="mb-4 rounded-lg border border-border p-3">
              <div className="flex justify-between font-mono text-[11px]">
                <span>reading the shoot…</span>
                <span className="text-rust">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-rust transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {!shots.length && !progress ? (
            <div
              onClick={() => inputRef.current?.click()}
              className="mt-16 cursor-pointer rounded-xl border border-dashed border-border px-6 py-24 text-center transition-colors hover:border-ink/30"
            >
              <h1 className="font-display text-3xl font-semibold tracking-tight">
                Drop the shoot anywhere.
              </h1>
              <p className="mt-2 font-mono text-[11px] text-moss">
                RAW or JPEG · stays on your machine · then just tell it what you want
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {visible.map((s) => (
                <button
                  key={s.id}
                  onClick={() =>
                    setShots((prev) =>
                      prev.map((x) =>
                        x.id === s.id
                          ? { ...x, verdict: x.verdict === "keep" ? "reject" : "keep" }
                          : x,
                      ),
                    )
                  }
                  className={`group overflow-hidden rounded-lg border text-left transition-colors ${
                    s.verdict === "keep"
                      ? "border-ink"
                      : s.verdict === "reject"
                        ? "border-border opacity-40"
                        : "border-border"
                  }`}
                >
                  {s.previewUrl ? (
                    <img
                      src={s.previewUrl}
                      alt={s.name}
                      loading="lazy"
                      className="aspect-[3/2] w-full object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[3/2] place-items-center font-mono text-[10px] text-moss">
                      unreadable
                    </div>
                  )}
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="truncate font-mono text-[10px] text-moss">{s.name}</span>
                    <span className="font-mono text-[10px]">{s.score}</span>
                  </div>
                  {s.flags.length > 0 && (
                    <div className="px-2 pb-1.5 font-mono text-[9px] text-rust">
                      {s.flags.map((f) => FLAG_LABEL[f]).join(" · ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink/70">
          <p className="font-display text-3xl font-semibold text-paper2">Drop it.</p>
        </div>
      )}
    </div>
  );
}
