import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditSlider } from "@/components/studio/Slider";
import { CullChat, type ToolCall } from "@/components/studio/CullChat";
import {
  DEFAULT_EDITS,
  type Edits,
  type Flag,
  type Shot,
  type Verdict,
  analyseBitmap,
  analyseFaces,
  autoRefine,
  baseName,
  buildXmpSidecar,
  decodeFile,
  faceDetectionAvailable,
  parseXmpSidecar,
  exportShot,
  isDuplicatePair,
  histogram,
  isRawFile,
  renderToCanvas,
  scoreOf,
} from "@/lib/imaging";
import { bridgeCredentials, bridgeFetch } from "@/lib/bridge-client";
import {

  bridgeEndpoint,
  downloadLightroomPlugin,
  type BridgeState,
} from "@/lib/lightroom-plugin";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "LensLabs Studio — Cull & Develop Your Shoot" },
      {
        name: "description",
        content:
          "Import a RAW or JPEG shoot, get every frame scored and flagged, keep or reject with one key, then develop and export your picks.",
      },
      { property: "og:title", content: "LensLabs Studio — Cull & Develop Your Shoot" },
      {
        property: "og:description",
        content: "The LensLabs culling bench: score, flag, keep, develop, export.",
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
    const started = performance.now();
    const stamp = Date.now();
    const added: Shot[] = new Array(files.length);
    let doneCount = 0;

    const one = async (i: number) => {
      const file = files[i]!;
      const id = `${file.name}-${file.size}-${i}-${stamp}`;
      const raw = isRawFile(file);
      try {
        // Cull-resolution decode: analysis never needs the full 45MP frame.
        const bitmap = await decodeFile(file, 1280);
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
        const blob = await new Promise<Blob | null>((res) =>
          thumb.toBlob(res, "image/jpeg", 0.72),
        );
        const url = blob ? URL.createObjectURL(blob) : null;

        added[i] = ({
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
          tone: analysis.tone,
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
        added[i] = ({
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
      doneCount++;
      setProgress({ done: doneCount, total: files.length });
    };

    // Parallel decode lanes — one per core, capped at 8.
    const lanes = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(lanes, files.length) }, async () => {
        while (cursor < files.length) await one(cursor++);
      }),
    );

    const batch = added.filter(Boolean);

    setShots((prev) => {
      const next = [...prev, ...batch];
      // duplicate detection across the whole set
      for (let i = 0; i < next.length; i++) {
        if (!next[i]!.hash) continue;
        for (let j = i + 1; j < next.length; j++) {
          if (!next[j]!.hash) continue;
          if (isDuplicatePair(next[i]!, next[j]!)) {
            const weaker = next[i]!.score >= next[j]!.score ? next[j]! : next[i]!;
            if (!weaker.flags.includes("duplicate")) weaker.flags = [...weaker.flags, "duplicate"];
          }
        }
      }
      return next;
    });
    setProgress(null);
    setSelectedId((cur) => cur ?? batch[0]?.id ?? null);
    const secs = (performance.now() - started) / 1000;
    setSyncNote(
      `${batch.length} frame${batch.length === 1 ? "" : "s"} read in ${secs.toFixed(1)}s · ${Math.round(batch.length / Math.max(secs, 0.001))}/sec`,
    );
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
        const res = await bridgeFetch(`${bridgeEndpoint()}?side=studio`, { cache: "no-store" });
        const state = (await res.json()) as BridgeState;
        if (!state.at || state.at === lastBridgeAt.current) return;
        lastBridgeAt.current = state.at;
        const n = mergeBridge(state);
        if (n) setSyncNote(`Lightroom pushed ${n} frame${n === 1 ? "" : "s"} · develop settings, rating and IPTC applied.`);
      } catch {
        if (!quiet) setSyncNote("LensLabs bridge unreachable — is the studio server running?");
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

  /** Publish LensLabs verdicts so the plugin's "Pull" writes them into the catalog. */
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
      const res = await bridgeFetch(bridgeEndpoint(), {
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
      setSyncNote(`${frames.length} frames queued for Lightroom — run Plug-in Extras → “Pull LensLabs verdicts”.`);
    } catch {
      setSyncNote("Could not reach the LensLabs bridge to publish verdicts.");
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
        renderToCanvas(canvas, bmp, selected.edits, 1400, selected.faces?.center ?? null);
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

  /** Lightroom-style Auto: derive develop settings from the frame's own histogram. */
  const autoRefineOne = (id?: string) => {
    const target = id ?? selectedId;
    if (!target) return;
    setShots((prev) =>
      prev.map((s) =>
        s.id === target && !s.error && s.tone
          ? { ...s, edits: autoRefine(s.tone, s.edits) }
          : s,
      ),
    );
  };

  const autoRefineMany = (scope: "keepers" | "all") => {
    let n = 0;
    setShots((prev) =>
      prev.map((s) => {
        if (s.error || !s.tone) return s;
        if (scope === "keepers" && s.verdict !== "keep") return s;
        n++;
        return { ...s, edits: autoRefine(s.tone, s.edits) };
      }),
    );
    return n;
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
    await exportShot(bmp, selected.edits, selected.name, selected.faces?.center ?? null);
    setBusy(null);
  };

  const exportKeepers = async () => {
    const keepers = shots.filter((s) => s.verdict === "keep" && !s.error);
    for (let i = 0; i < keepers.length; i++) {
      setBusy(`Exporting ${i + 1}/${keepers.length}…`);
      const bmp = await decodeFile(keepers[i]!.file);
      await exportShot(bmp, keepers[i]!.edits, keepers[i]!.name, keepers[i]!.faces?.center ?? null);
      bmp.close?.();
      await new Promise((r) => setTimeout(r, 250));
    }
    setBusy(null);
  };

  /* ---------------- assistant ---------------- */
  const chatContext = useMemo(() => {
    if (!shots.length) return "No shoot loaded yet. Use import_photos to open the picker.";
    const flagCount: Record<string, number> = {};
    for (const s of shots) for (const f of s.flags) flagCount[f] = (flagCount[f] ?? 0) + 1;
    return [
      `${counts.all} frames · ${counts.keepers} keepers · ${counts.rejected} rejected · ${counts.todo} still undecided`,
      `flags: ${Object.entries(flagCount).map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`,
      `filter showing: ${filter}`,
      selected
        ? `open frame: ${selected.name} (score ${selected.score}, ${selected.verdict})`
        : "no frame open",
    ].join("\n");
  }, [shots, counts, filter, selected]);

  const executeTool = useCallback(
    async ({ name, args }: ToolCall): Promise<string> => {
      const num = (k: string) => (typeof args[k] === "number" ? (args[k] as number) : undefined);
      switch (name) {
        case "import_photos":
          inputRef.current?.click();
          return "file picker opened";
        case "cull": {
          const min = num("min_score") ?? 45;
          const keepAt = num("keep_score") ?? 70;
          let kept = 0;
          let rejected = 0;
          setShots((prev) =>
            prev.map((s) => {
              if (s.error) return s;
              const bad =
                s.flags.includes("blur") ||
                s.flags.includes("duplicate") ||
                s.flags.includes("eyes-closed") ||
                s.score < min;
              if (bad) rejected++;
              else if (s.score >= keepAt) kept++;
              return { ...s, verdict: bad ? "reject" : s.score >= keepAt ? "keep" : s.verdict };
            }),
          );
          return `culled ${shots.length} frames — ${kept} kept, ${rejected} rejected`;
        }
        case "keep_top": {
          const n = Math.max(1, Math.round(num("n") ?? 10));
          const ranked = [...shots]
            .filter((s) => !s.error)
            .sort((a, b) => b.score - a.score)
            .slice(0, n);
          const ids = new Set(ranked.map((s) => s.id));
          setShots((prev) =>
            prev.map((s) =>
              s.error ? s : { ...s, verdict: ids.has(s.id) ? "keep" : "reject" },
            ),
          );
          return `kept top ${ids.size}, rejected the rest`;
        }
        case "reject_flagged": {
          const flags = (Array.isArray(args['flags']) ? args['flags'] : []) as Flag[];
          let n = 0;
          setShots((prev) =>
            prev.map((s) => {
              if (s.error || !s.flags.some((f) => flags.includes(f))) return s;
              n++;
              return { ...s, verdict: "reject" };
            }),
          );
          return `rejected ${n} frames flagged ${flags.join(", ")}`;
        }
        case "set_filter": {
          const f = String(args['filter'] ?? "all") as Filter;
          setFilter(f);
          return `showing ${f}`;
        }
        case "select_photo": {
          const q = String(args['query'] ?? "").trim().toLowerCase();
          const pool = shots.filter((s) => !s.error);
          if (!pool.length) return "nothing to open";
          let target = pool.find((s) => s.name.toLowerCase().includes(q));
          if (!target && q === "best") target = [...pool].sort((a, b) => b.score - a.score)[0];
          if (!target && q === "worst") target = [...pool].sort((a, b) => a.score - b.score)[0];
          if (!target && /^\d+$/.test(q)) target = pool[Number(q) - 1];
          if (!target) return `no frame matched "${q}"`;
          setSelectedId(target.id);
          return `opened ${target.name}`;
        }
        case "apply_edits": {
          const patch: Partial<Edits> = {};
          const map: [string, keyof Edits][] = [
            ["exposure", "exposure"],
            ["contrast", "contrast"],
            ["temperature", "temp"],
            ["saturation", "saturation"],
            ["highlights", "highlights"],
            ["shadows", "shadows"],
          ];
          for (const [from, to] of map) {
            const v = num(from);
            if (v !== undefined) (patch as Record<string, unknown>)[to] = Math.max(-100, Math.min(100, v));
          }
          if (typeof args['crop'] === "string") patch.crop = args['crop'] as Edits["crop"];
          if (!Object.keys(patch).length) return "no settings given";
          const toKeepers = args['target'] === "keepers";
          let n = 0;
          setShots((prev) =>
            prev.map((s) => {
              const hit = toKeepers ? s.verdict === "keep" : s.id === selectedId;
              if (!hit || s.error) return s;
              n++;
              return { ...s, edits: { ...s.edits, ...patch } };
            }),
          );
          return `applied ${Object.keys(patch).join(", ")} to ${n} frame${n === 1 ? "" : "s"}`;
        }
        case "auto_refine": {
          const scope = args['target'] === "selected" ? "selected" : (args['target'] === "all" ? "all" : "keepers");
          if (scope === "selected") {
            if (!selectedId) return "no frame open";
            autoRefineOne(selectedId);
            return "auto-refined the open frame";
          }
          const pool = shots.filter(
            (s) => !s.error && s.tone && (scope === "all" || s.verdict === "keep"),
          ).length;
          if (!pool) return "nothing to refine";
          autoRefineMany(scope);
          return `auto-refined ${pool} frame${pool === 1 ? "" : "s"}`;
        }
        case "export_keepers": {
          const n = shots.filter((s) => s.verdict === "keep" && !s.error).length;
          if (!n) return "no keepers to export";
          void exportKeepers();
          return `exporting ${n} keepers in the background`;
        }
        case "write_xmp": {
          const n = shots.filter((s) => s.verdict !== "undecided" && !s.error).length;
          if (!n) return "nothing decided yet";
          exportSidecars();
          return `wrote ${n} xmp sidecars`;
        }
        default:
          return "unknown tool";
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, selectedId],
  );

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
      else if (k === "a") autoRefineOne();
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
      <header className="sticky top-0 z-30 border-b border-border/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex shrink-0 items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-ink font-display text-[11px] font-bold text-paper2">
                L
              </span>
              <span className="font-display text-sm font-semibold tracking-tight">LensLabs</span>
            </Link>
            <span className="truncate font-mono text-[11px] text-moss">
              {shots.length
                ? `${counts.all} frames · ${counts.todo} to review · ${counts.keepers} keepers`
                : "no shoot loaded"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            {!!counts.keepers && (
              <button
                onClick={() => void exportKeepers()}
                className="rounded-md px-2.5 py-1.5 text-moss transition-colors hover:bg-ink/5 hover:text-ink"
              >
                Export {counts.keepers}
              </button>
            )}
            <button
              onClick={() => (shots.length ? autoCull() : inputRef.current?.click())}
              className="rounded-md bg-ink px-3 py-1.5 text-paper2 transition-colors hover:bg-rust"
            >
              {shots.length ? "Auto-cull" : "Import"}
            </button>
            <details className="relative">
              <summary className="grid size-7 cursor-pointer list-none place-items-center rounded-md text-moss transition-colors hover:bg-ink/5 hover:text-ink [&::-webkit-details-marker]:hidden">
                ···
              </summary>
              <div className="absolute right-0 z-40 mt-1.5 w-60 rounded-lg border border-border bg-paper2 p-1 shadow-xl">
                {(
                  [
                    ["Import files", () => inputRef.current?.click(), false],
                    ["Import Lightroom folder", () => folderRef.current?.click(), false],
                    [
                      "Write XMP sidecars",
                      exportSidecars,
                      !shots.some((s) => s.verdict !== "undecided"),
                    ],
                    ["Publish verdicts to Lightroom", () => void pushToLightroom(), !shots.length],
                    [
                      "Download Lightroom plugin",
                      () => {
                        void bridgeCredentials().then((creds) => {
                          const endpoint = downloadLightroomPlugin(creds);
                          setSyncNote(`Plugin downloaded · endpoint ${endpoint}`);
                        });
                      },
                      false,
                    ],
                    [
                      linked ? "Live sync · on" : "Live sync · off",
                      () => setLinked((v) => !v),
                      false,
                    ],
                  ] as [string, () => void, boolean][]
                ).map(([label, run, disabled]) => (
                  <button
                    key={label}
                    disabled={disabled}
                    onClick={(e) => {
                      run();
                      (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-ink/5 disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>

        {syncNote && (
          <div className="mx-auto max-w-[1600px] px-5 pb-2 font-mono text-[11px] text-rust">
            {syncNote}
          </div>
        )}
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

      <main className="mx-auto grid max-w-[1600px] gap-5 px-6 pb-20 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="min-w-0 xl:order-2">
        {!shots.length && !progress ? (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="mt-24 cursor-pointer rounded-xl border border-dashed border-border px-6 py-24 text-center transition-colors hover:border-ink/30"
          >
            <h1 className="font-display text-3xl font-semibold tracking-tight">Drop the shoot.</h1>
            <p className="mt-2 font-mono text-[11px] text-moss">
              RAW or JPEG · stays on your machine · ⌘ nothing else to set up
            </p>
            <p className="mt-10 font-mono text-[11px] text-moss">
              K keep · X reject · ← → move
            </p>
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
                      {s.develop && (
                        <span
                          className="absolute bottom-0 right-0 bg-paper2/85 px-1 font-mono text-[8px] uppercase text-ink"
                          title={`develop · ${s.develop.origin}`}
                        >
                          {s.develop.origin === "lens os" ? "OS" : "LR"}
                        </span>
                      )}
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
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            selected.develop ? "bg-ink text-paper2" : "border border-input"
                          }`}
                          title={
                            selected.develop
                              ? `Last develop update ${new Date(selected.develop.at).toLocaleTimeString()}`
                              : "No develop settings applied yet"
                          }
                        >
                          develop ·{" "}
                          {selected.develop
                            ? selected.develop.origin === "lightroom"
                              ? "from Lightroom (live)"
                              : selected.develop.origin === "sidecar"
                                ? "from XMP sidecar"
                                : "LensLabs, published"
                            : "untouched"}
                        </span>
                        {selected.develop?.rating !== undefined && selected.develop.rating !== null && (
                          <span className="rounded-full border border-input px-2 py-0.5">
                            {selected.develop.rating}★
                          </span>
                        )}
                        {selected.develop?.label && (
                          <span className="rounded-full border border-input px-2 py-0.5">
                            {selected.develop.label} label
                          </span>
                        )}
                        {selected.develop?.caption && (
                          <span className="rounded-full border border-input px-2 py-0.5">
                            IPTC: {selected.develop.caption}
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
                        <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-border pt-4">
                          <button
                            onClick={() => autoRefineOne()}
                            disabled={!selected.tone}
                            className="rounded-full bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-paper2 transition-colors hover:bg-rust disabled:opacity-40"
                          >
                            Auto refine · A
                          </button>
                          <button
                            onClick={() => autoRefineMany("keepers")}
                            disabled={!counts.keepers}
                            className="rounded-full border border-input px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider hover:bg-ink hover:text-paper2 disabled:opacity-40"
                          >
                            Auto refine all keepers
                          </button>
                          <span className="font-mono text-[10px] text-moss">
                            tone, white balance and recovery from this frame's histogram
                          </span>
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
        </div>

        {/* assistant rail — chat while it culls in the background */}
        <aside className="xl:order-1 xl:sticky xl:top-16 xl:h-[calc(100vh-5rem)]">
          <div className="h-full rounded-sm bg-paper2 p-4 shadow-2xl ring-1 ring-border">
            <CullChat context={chatContext} execute={executeTool} />
          </div>
        </aside>
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
