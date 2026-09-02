import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditSlider } from "@/components/studio/Slider";
import {
  DEFAULT_EDITS,
  type Edits,
  type Flag,
  type Shot,
  type Verdict,
  analyseBitmap,
  analyseFaces,
  baseName,
  buildXmpSidecar,
  decodeFile,
  faceDetectionAvailable,
  parseXmpSidecar,
  exportShot,
  hamming,
  histogram,
  isRawFile,
  renderToCanvas,
  scoreOf,
} from "@/lib/imaging";
import {
  BRIDGE_PATH,
  downloadLightroomPlugin,
  type BridgeState,
} from "@/lib/lightroom-plugin";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Lens OS Studio — Cull & Develop Your Shoot" },
      {
        name: "description",
        content:
          "Import a RAW or JPEG shoot, get every frame scored and flagged, keep or reject with one key, then develop and export your picks.",
      },
      { property: "og:title", content: "Lens OS Studio — Cull & Develop Your Shoot" },
      {
        property: "og:description",
        content: "The Lens OS culling bench: score, flag, keep, develop, export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

type Filter = "all" | "keepers" | "flagged" | "rejected" | "todo";

const FLAG_LABEL: Record<Flag, string> = {
  soft: "soft focus",
  blur: "blurred",
  underexposed: "underexposed",
  overexposed: "blown highlights",
  duplicate: "duplicate",
  "face-soft": "face not sharp",
  "eyes-closed": "eyes closed",
};

const CROPS: Edits["crop"][] = ["orig", "1:1", "4:5", "3:2", "16:9"];

function Studio() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [bins, setBins] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapCache = useRef(new Map<string, ImageBitmap>());
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [faceEngine, setFaceEngine] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  useEffect(() => setFaceEngine(faceDetectionAvailable()), []);

  /* ---------------- import ---------------- */
  const importFiles = useCallback(async (files: File[]) => {
    // Lightroom folders carry .xmp sidecars next to the negatives.
    const sidecars = new Map<string, string>();
    const sidecarFiles = files.filter((f) => f.name.toLowerCase().endsWith(".xmp"));
    for (const f of sidecarFiles) {
      try {
        sidecars.set(baseName(f.name).toLowerCase(), await f.text());
      } catch {
        /* unreadable sidecar is simply skipped */
      }
    }
    files = files.filter((f) => !f.name.toLowerCase().endsWith(".xmp"));
    if (sidecars.size) {
      setSyncNote(`${sidecars.size} Lightroom sidecar${sidecars.size === 1 ? "" : "s"} read — develop settings and picks applied.`);
    }
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    const added: Shot[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const id = `${file.name}-${file.size}-${i}-${Date.now()}`;
      const raw = isRawFile(file);
      try {
        const bitmap = await decodeFile(file);
        const analysis = analyseBitmap(bitmap);
        const faces = await analyseFaces(bitmap);
        const { score, flags } = scoreOf({ ...analysis, faces });

        const sidecar = sidecars.get(baseName(file.name).toLowerCase());
        const parsed = sidecar ? parseXmpSidecar(sidecar) : null;

        const thumb = document.createElement("canvas");
        const s = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
        thumb.width = Math.round(bitmap.width * s);
        thumb.height = Math.round(bitmap.height * s);
        thumb.getContext("2d")!.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
        const url = thumb.toDataURL("image/jpeg", 0.7);

        added.push({
          id,
          file,
          name: file.name,
          isRaw: raw,
          previewUrl: url,
          width: bitmap.width,
          height: bitmap.height,
          sizeMb: file.size / 1e6,
          sharpness: analysis.sharpness,
          brightness: analysis.brightness,
          clippedHighlights: analysis.clippedHighlights,
          clippedShadows: analysis.clippedShadows,
          hash: analysis.hash,
          score,
          flags,
          verdict:
            parsed?.pick === 1 || (parsed?.rating ?? 0) >= 3
              ? "keep"
              : parsed?.pick === -1
                ? "reject"
                : "undecided",
          edits: { ...DEFAULT_EDITS, ...(parsed?.edits ?? {}) },
          faces: faces ?? undefined,
          develop: parsed
            ? {
                origin: "sidecar",
                at: Date.now(),
                rating: parsed.rating ?? undefined,
              }
            : undefined,
        });
        bitmap.close?.();
      } catch (err) {
        added.push({
          id,
          file,
          name: file.name,
          isRaw: raw,
          previewUrl: null,
          width: 0,
          height: 0,
          sizeMb: file.size / 1e6,
          sharpness: 0,
          brightness: 0,
          clippedHighlights: 0,
          clippedShadows: 0,
          hash: "",
          score: 0,
          flags: [],
          verdict: "undecided",
          edits: { ...DEFAULT_EDITS },
          error: err instanceof Error ? err.message : "Could not read this file",
        });
      }
      setProgress({ done: i + 1, total: files.length });
      // let the UI breathe between frames
      await new Promise((r) => setTimeout(r, 0));
    }

    setShots((prev) => {
      const next = [...prev, ...added];
      // duplicate detection across the whole set
      for (let i = 0; i < next.length; i++) {
        if (!next[i]!.hash) continue;
        for (let j = i + 1; j < next.length; j++) {
          if (!next[j]!.hash) continue;
          if (hamming(next[i]!.hash, next[j]!.hash) <= 5) {
            const weaker = next[i]!.score >= next[j]!.score ? next[j]! : next[i]!;
            if (!weaker.flags.includes("duplicate")) weaker.flags = [...weaker.flags, "duplicate"];
          }
        }
      }
      return next;
    });
    setProgress(null);
    setSelectedId((cur) => cur ?? added[0]?.id ?? null);
  }, []);

  /* ---------------- Lightroom live bridge ---------------- */
  const lastBridgeAt = useRef(0);

  const mergeBridge = useCallback((state: BridgeState) => {
    if (!state?.frames?.length) return 0;
    let touched = 0;
    setShots((prev) =>
      prev.map((s) => {
        const frame = state.frames.find(
          (f) => baseName(f.file ?? "").toLowerCase() === baseName(s.name).toLowerCase(),
        );
        if (!frame) return s;
        touched++;
        const d = frame.develop ?? {};
        const next: Shot = {
          ...s,
          edits: {
            ...s.edits,
            ...(d.exposure !== undefined
              ? { exposure: Math.max(-100, Math.min(100, d.exposure * 20)) }
              : {}),
            ...(d.contrast !== undefined ? { contrast: d.contrast } : {}),
            ...(d.highlights !== undefined ? { highlights: d.highlights } : {}),
            ...(d.shadows !== undefined ? { shadows: d.shadows } : {}),
            ...(d.saturation !== undefined ? { saturation: d.saturation } : {}),
            ...(d.temperature !== undefined
              ? { temp: Math.max(-100, Math.min(100, ((d.temperature - 5500) / 4500) * 100)) }
              : {}),
          },
          verdict:
            frame.pick === 1 || (frame.rating ?? 0) >= 3
              ? "keep"
              : frame.pick === -1
                ? "reject"
                : s.verdict,
          develop: {
            origin: "lightroom",
            at: Date.now(),
            rating: frame.rating,
            label: frame.label ?? null,
            caption: frame.iptc?.caption,
            cropped: d.cropped,
            processVersion: d.processVersion,
          },
        };
        return next;
      }),
    );
    return touched;
  }, []);

  const pullFromLightroom = useCallback(
    async (quiet = false) => {
      try {
        const res = await fetch(`${BRIDGE_PATH}?side=studio`, { cache: "no-store" });
        const state = (await res.json()) as BridgeState;
        if (!state.at || state.at === lastBridgeAt.current) return;
        lastBridgeAt.current = state.at;
        const n = mergeBridge(state);
        if (n) setSyncNote(`Lightroom pushed ${n} frame${n === 1 ? "" : "s"} · develop settings, rating and IPTC applied.`);
      } catch {
        if (!quiet) setSyncNote("Lens OS bridge unreachable — is the studio server running?");
      }
    },
    [mergeBridge],
  );

  useEffect(() => {
    if (!linked) return;
    void pullFromLightroom(true);
    const t = setInterval(() => void pullFromLightroom(true), 4000);
    return () => clearInterval(t);
  }, [linked, pullFromLightroom]);

  /** Publish Lens OS verdicts so the plugin's "Pull" writes them into the catalog. */
  const pushToLightroom = useCallback(async () => {
    const frames = shots
      .filter((s) => !s.error)
      .map((s) => ({
        file: s.name,
        verdict: s.verdict,
        score: s.score,
        rating: s.verdict === "reject" ? 0 : Math.max(1, Math.min(5, Math.round(s.score / 20))),
        label: s.verdict === "keep" ? "Green" : s.verdict === "reject" ? "Red" : null,
        develop: {
          exposure: s.edits.exposure / 20,
          contrast: s.edits.contrast,
          highlights: s.edits.highlights,
          shadows: s.edits.shadows,
          saturation: s.edits.saturation,
          temperature: Math.round(5500 + (s.edits.temp / 100) * 4500),
        },
      }));
    try {
      const res = await fetch(BRIDGE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "verdicts", direction: "to-lightroom", frames }),
      });
      if (!res.ok) throw new Error();
      setShots((prev) =>
        prev.map((s) =>
          s.error ? s : { ...s, develop: { ...(s.develop ?? { origin: "lens os" as const }), origin: "lens os" as const, at: Date.now() } },
        ),
      );
      setSyncNote(`${frames.length} frames queued for Lightroom — run Plug-in Extras → “Pull Lens OS verdicts”.`);
    } catch {
      setSyncNote("Could not reach the Lens OS bridge to publish verdicts.");
    }
  }, [shots]);



  /* ---------------- derived ---------------- */
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

  const selected = shots.find((s) => s.id === selectedId) ?? null;
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

  /* ---------------- loupe render ---------------- */
  const getBitmap = useCallback(async (shot: Shot) => {
    const cached = bitmapCache.current.get(shot.id);
    if (cached) return cached;
    const bmp = await decodeFile(shot.file);
    if (bitmapCache.current.size > 4) {
      const [firstKey] = bitmapCache.current.keys();
      const old = bitmapCache.current.get(firstKey!);
      old?.close?.();
      bitmapCache.current.delete(firstKey!);
    }
    bitmapCache.current.set(shot.id, bmp);
    return bmp;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!selected || selected.error || !canvas) return;
    (async () => {
      try {
        const bmp = await getBitmap(selected);
        if (cancelled) return;
        renderToCanvas(canvas, bmp, selected.edits, 1400);
        setBins(histogram(canvas));
      } catch {
        /* preview unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, getBitmap]);

  /* ---------------- actions ---------------- */
  const setVerdict = useCallback(
    (id: string, verdict: Verdict, advance = true) => {
      setShots((prev) => prev.map((s) => (s.id === id ? { ...s, verdict } : s)));
      if (!advance) return;
      const idx = visible.findIndex((s) => s.id === id);
      const next = visible[idx + 1];
      if (next) setSelectedId(next.id);
    },
    [visible],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!selectedId) return;
      const idx = visible.findIndex((s) => s.id === selectedId);
      const next = visible[idx + dir];
      if (next) setSelectedId(next.id);
    },
    [visible, selectedId],
  );

  const updateEdits = (patch: Partial<Edits>) => {
    if (!selected) return;
    setShots((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, edits: { ...s.edits, ...patch } } : s)),
    );
  };

  const autoCull = () => {
    setShots((prev) =>
      prev.map((s) => {
        if (s.error) return s;
        const bad =
          s.flags.includes("blur") ||
          s.flags.includes("duplicate") ||
          s.flags.includes("eyes-closed") ||
          s.score < 45;
        return { ...s, verdict: bad ? "reject" : s.score >= 70 ? "keep" : s.verdict };
      }),
    );
  };

  const exportOne = async () => {
    if (!selected || selected.error) return;
    setBusy("Exporting…");
    const bmp = await getBitmap(selected);
    await exportShot(bmp, selected.edits, selected.name);
    setBusy(null);
  };

  const exportKeepers = async () => {
    const keepers = shots.filter((s) => s.verdict === "keep" && !s.error);
    for (let i = 0; i < keepers.length; i++) {
      setBusy(`Exporting ${i + 1}/${keepers.length}…`);
      const bmp = await decodeFile(keepers[i]!.file);
      await exportShot(bmp, keepers[i]!.edits, keepers[i]!.name);
      bmp.close?.();
      await new Promise((r) => setTimeout(r, 250));
    }
    setBusy(null);
  };

  /** Write .xmp sidecars Lightroom picks up on folder re-read. */
  const exportSidecars = () => {
    const done = shots.filter((s) => s.verdict !== "undecided" && !s.error);
    for (const shot of done) {
      const rating =
        shot.verdict === "reject" ? 0 : Math.max(1, Math.min(5, Math.round(shot.score / 20)));
      const xml = buildXmpSidecar(shot.edits, shot.verdict, rating);
      const url = URL.createObjectURL(new Blob([xml], { type: "application/rdf+xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName(shot.name)}.xmp`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setSyncNote(`${done.length} sidecar${done.length === 1 ? "" : "s"} written — re-read metadata in Lightroom to sync.`);
  };

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (!selectedId) return;
      const k = e.key.toLowerCase();
      if (k === "arrowright" || k === "arrowdown") { e.preventDefault(); step(1); }
      else if (k === "arrowleft" || k === "arrowup") { e.preventDefault(); step(-1); }
      else if (k === "k") setVerdict(selectedId, "keep");
      else if (k === "x") setVerdict(selectedId, "reject");
      else if (k === "u") setVerdict(selectedId, "undecided", false);
      else if (k === "r") updateEdits({ ...DEFAULT_EDITS });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, step, setVerdict]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void importFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="paper-tex min-h-screen text-ink">
      <header className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-5">
        <Link to="/" className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-rust font-display text-lg font-bold text-paper2">
            L
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Lens OS</span>
          <span className="mt-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
            studio
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-ink px-4 py-2 uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-rust"
          >
            Import shoot
          </button>
          <button
            onClick={() => folderRef.current?.click()}
            className="rounded-full border border-input px-4 py-2 uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2"
          >
            Lightroom folder
          </button>
          <button
            onClick={exportSidecars}
            disabled={!shots.some((s) => s.verdict !== "undecided")}
            className="rounded-full border border-input px-4 py-2 uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2 disabled:opacity-40"
          >
            Sync XMP back
          </button>
          <button
            onClick={() => {
              const endpoint = downloadLightroomPlugin();
              setSyncNote(`Plugin downloaded · endpoint ${endpoint} — add it in Lightroom's Plug-in Manager.`);
            }}
            className="rounded-full border border-input px-4 py-2 uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2"
          >
            Lightroom plugin
          </button>
          <button
            onClick={() => setLinked((v) => !v)}
            className={`rounded-full px-4 py-2 uppercase tracking-[0.12em] transition-colors ${
              linked ? "bg-rust text-paper2" : "border border-input hover:bg-ink hover:text-paper2"
            }`}
          >
            {linked ? "Live sync · on" : "Live sync · off"}
          </button>
          <button
            onClick={() => void pushToLightroom()}
            disabled={!shots.length}
            className="rounded-full border border-input px-4 py-2 uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2 disabled:opacity-40"
          >
            Publish verdicts
          </button>
          <button
            onClick={autoCull}
            disabled={!shots.length}
            className="rounded-full border border-input px-4 py-2 uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2 disabled:opacity-40"
          >
            Auto-cull
          </button>
          <button
            onClick={() => void exportKeepers()}
            disabled={!counts.keepers}
            className="rounded-full border border-input px-4 py-2 uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2 disabled:opacity-40"
          >
            Export keepers ({counts.keepers})
          </button>
        </div>
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
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.nef,.cr2,.cr3,.arw,.dng,.raf,.orf,.rw2,.pef,.srw,.xmp"
          className="hidden"
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </header>

      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-6 pb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
        <span>{faceEngine ? "Face + eye engine · on" : "Face + eye engine · unavailable in this browser"}</span>
        {syncNote && <span className="text-rust normal-case tracking-normal">{syncNote}</span>}
      </div>

      {progress && (
        <div className="mx-auto max-w-[1600px] px-6 pb-4">
          <div className="rounded-sm bg-paper2 p-4 shadow ring-1 ring-border">
            <div className="flex justify-between font-mono text-[11px]">
              <span>Ingesting shoot…</span>
              <span className="text-rust">
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-ink/15">
              <div
                className="h-full rounded-full bg-rust transition-[width]"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-6 pb-20">
        {!shots.length && !progress ? (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="torn bg-paper2 px-6 py-20 text-center shadow-2xl"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-rust">
              Step 01 · Ingest
            </span>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
              Drop your shoot on the bench
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-moss">
              Select all 300 files at once — JPEG, PNG, HEIC-exported or RAW (NEF, CR2, CR3, ARW,
              DNG, RAF, ORF, RW2). Nothing leaves your machine: Lens OS reads the embedded preview
              from RAW files and scores everything locally.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-8 rounded-full bg-rust px-8 py-3 font-mono text-sm uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-ink"
            >
              Choose files
            </button>
            <p className="mt-4 font-mono text-[11px] text-moss">or drag the folder contents here</p>
          </div>
        ) : (
          <div className="rounded-sm bg-paper2 p-5 shadow-2xl ring-1 ring-border md:p-7">
            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-moss">Filter</span>
              {(
                [
                  ["all", `All ${counts.all}`],
                  ["todo", `To review ${counts.todo}`],
                  ["keepers", `Keepers ${counts.keepers}`],
                  ["flagged", `Flagged ${counts.flagged}`],
                  ["rejected", `Rejected ${counts.rejected}`],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] transition-colors ${
                    filter === key
                      ? "bg-ink text-paper2"
                      : "border border-input hover:bg-ink hover:text-paper2"
                  }`}
                >
                  {label}
                </button>
              ))}
              {busy && <span className="ml-auto font-mono text-[11px] text-rust">{busy}</span>}
            </div>

            <div className="grid gap-5 pt-5 lg:grid-cols-12">
              {/* filmstrip */}
              <div className="lg:col-span-5">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
                  Filmstrip · {visible.length} frames
                </div>
                <div className="grid max-h-[520px] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
                  {visible.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      title={`${s.name} · score ${s.score}`}
                      className={`relative aspect-[4/5] overflow-hidden bg-mist/50 outline -outline-offset-2 ${
                        s.id === selectedId ? "outline-2 outline-rust" : "outline-1 outline-ink/10"
                      }`}
                    >
                      {s.previewUrl ? (
                        <img
                          src={s.previewUrl}
                          alt={s.name}
                          loading="lazy"
                          className={`size-full object-cover ${
                            s.verdict === "reject" ? "opacity-30" : ""
                          }`}
                        />
                      ) : (
                        <span className="grid size-full place-items-center px-1 font-mono text-[8px] text-moss">
                          no preview
                        </span>
                      )}
                      <span className="absolute bottom-0 left-0 bg-ink/70 px-1 font-mono text-[9px] text-paper2">
                        {s.score || "—"}
                      </span>
                      {s.verdict === "keep" && (
                        <span className="absolute right-1 top-1 size-2 rounded-full bg-moss" />
                      )}
                      {s.verdict === "reject" && (
                        <span className="absolute right-1 top-1 size-2 rounded-full bg-rust" />
                      )}
                      {s.flags.length > 0 && s.verdict === "undecided" && (
                        <span className="absolute right-1 top-1 size-2 rounded-full bg-sun" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-3 font-mono text-[10px] text-moss">
                  ← → browse · K keep · X reject · U undo · R reset edits
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <FlagTile label="Blur / soft" n={countFlag(shots, ["blur", "soft"])} tone="rust" />
                  <FlagTile
                    label="Exposure"
                    n={countFlag(shots, ["underexposed", "overexposed"])}
                    tone="rust"
                  />
                  <FlagTile label="Duplicates" n={countFlag(shots, ["duplicate"])} tone="sun" />
                </div>
              </div>

              {/* loupe */}
              <div className="lg:col-span-7">
                {selected ? (
                  <>
                    <div className="relative grid min-h-[300px] place-items-center bg-ink/5 outline-1 -outline-offset-1 outline-ink/10">
                      {selected.error ? (
                        <p className="p-10 text-center font-mono text-[12px] text-rust">
                          {selected.error}
                          <br />
                          <span className="text-moss">
                            Export a JPEG/DNG preview from your camera or converter and re-import.
                          </span>
                        </p>
                      ) : (
                        <canvas ref={canvasRef} className="max-h-[520px] w-full object-contain" />
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
                      <span>
                        {selected.name} · {selected.width}×{selected.height} ·{" "}
                        {selected.sizeMb.toFixed(1)} MB {selected.isRaw && "· RAW"}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        {selected.flags.map((f) => (
                          <span
                            key={f}
                            className="rounded-full bg-sun px-2 py-0.5 text-[10px] text-ink"
                          >
                            {FLAG_LABEL[f]}
                          </span>
                        ))}
                        <span className="rounded-full bg-moss px-2 py-0.5 text-paper2">
                          score {selected.score}
                        </span>
                        {selected.faces && (
                          <span className="rounded-full border border-input px-2 py-0.5">
                            {selected.faces.count} face{selected.faces.count === 1 ? "" : "s"}
                            {selected.faces.eyesOpen === null
                              ? ""
                              : selected.faces.eyesOpen
                                ? " · eyes open"
                                : " · eyes closed"}
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => setVerdict(selected.id, "keep")}
                        className={`rounded-full px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                          selected.verdict === "keep"
                            ? "bg-moss text-paper2"
                            : "border border-input hover:bg-moss hover:text-paper2"
                        }`}
                      >
                        Keep · K
                      </button>
                      <button
                        onClick={() => setVerdict(selected.id, "reject")}
                        className={`rounded-full px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                          selected.verdict === "reject"
                            ? "bg-rust text-paper2"
                            : "border border-input hover:bg-rust hover:text-paper2"
                        }`}
                      >
                        Reject · X
                      </button>
                      <button
                        onClick={() => void exportOne()}
                        className="ml-auto rounded-full bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-rust"
                      >
                        Export frame
                      </button>
                    </div>

                    {/* histogram */}
                    <div className="mt-5 flex h-16 items-end gap-[2px] bg-ink/5 p-2">
                      {bins.map((b, i) => (
                        <span
                          key={i}
                          className="flex-1 rounded-[1px] bg-moss/70"
                          style={{ height: `${Math.max(2, b * 100)}%` }}
                        />
                      ))}
                    </div>

                    {/* edit desk */}
                    <div className="mt-5 border-t border-border pt-5">
                      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
                        Edit desk · Lightroom-style
                      </div>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-3">
                        <EditSlider
                          label="Exposure"
                          value={selected.edits.exposure}
                          onChange={(v) => updateEdits({ exposure: v })}
                        />
                        <EditSlider
                          label="Contrast"
                          value={selected.edits.contrast}
                          onChange={(v) => updateEdits({ contrast: v })}
                        />
                        <EditSlider
                          label="Temp (WB)"
                          value={selected.edits.temp}
                          onChange={(v) => updateEdits({ temp: v })}
                        />
                        <EditSlider
                          label="Highlights"
                          value={selected.edits.highlights}
                          onChange={(v) => updateEdits({ highlights: v })}
                        />
                        <EditSlider
                          label="Shadows"
                          value={selected.edits.shadows}
                          onChange={(v) => updateEdits({ shadows: v })}
                        />
                        <EditSlider
                          label="Saturation"
                          value={selected.edits.saturation}
                          onChange={(v) => updateEdits({ saturation: v })}
                        />
                        <div>
                          <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider">
                            <span>Crop</span>
                            <span className="text-ink/50">{selected.edits.crop}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {CROPS.map((c) => (
                              <button
                                key={c}
                                onClick={() => updateEdits({ crop: c })}
                                className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                                  selected.edits.crop === c
                                    ? "bg-ink text-paper2"
                                    : "border border-input"
                                }`}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => updateEdits({ ...DEFAULT_EDITS })}
                          className="self-end justify-self-start rounded-full border border-input px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider hover:bg-ink hover:text-paper2"
                        >
                          Reset · R
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="grid h-full place-items-center font-mono text-[11px] text-moss">
                    Select a frame from the filmstrip.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function countFlag(shots: Shot[], flags: Flag[]) {
  return shots.filter((s) => s.flags.some((f) => flags.includes(f))).length;
}

function FlagTile({ label, n, tone }: { label: string; n: number; tone: "rust" | "sun" }) {
  return (
    <div className="torn flex items-center justify-between bg-paper2 p-3 shadow">
      <span className="font-mono text-[11px]">{label}</span>
      <span
        className={`font-display text-xl font-semibold ${tone === "rust" ? "text-rust" : "text-sun"}`}
      >
        {n}
      </span>
    </div>
  );
}
