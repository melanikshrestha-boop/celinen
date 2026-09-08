import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useWorkbench } from "@/components/workbench/context";
import { decodeFile, renderToCanvas, type Shot } from "@/lib/imaging";
import {
  DEFAULT_SOCIAL_FRAME,
  prepareSocialFrame,
  SOCIAL_FORMATS,
  type SocialFrame,
} from "@/lib/social-frame";
import { makeZip } from "@/lib/zip";
import "./social-export.css";

const destinations = [
  { id: "instagram", label: "Instagram post", format: "portrait" },
  { id: "instagram-story", label: "Instagram Story", format: "story" },
  { id: "facebook-story", label: "Facebook Story", format: "story" },
] as const;
type Output = { id: string; label: string; blob: Blob; url: string };

/** Local preparation is distinct from confirmed external publication. */
export function SocialExport({
  open,
  onOpenChange,
  shot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shot: Shot | null;
}) {
  const workbench = useWorkbench();
  const [frame, setFrame] = useState<SocialFrame>(DEFAULT_SOCIAL_FRAME);
  const [channels, setChannels] = useState<string[]>(destinations.map((d) => d.id));
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [source, setSource] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [caption, setCaption] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const current = useRef(shot);
  current.current = shot;
  const outputRef = useRef(outputs);
  outputRef.current = outputs;
  const key = shot
    ? JSON.stringify([
        shot.id,
        shot.sourceDigest,
        shot.edits,
        shot.faces?.center,
        shot.sourceAvailable,
      ])
    : "";
  const invalidate = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const clear = useCallback(() => {
    invalidate();
    setBusy(false);
    setOutputs([]);
    setMessage("");
  }, [invalidate]);
  useEffect(() => {
    clear();
    setSource(null);
    let url: string | undefined;
    const operation = sequence.current;
    const active = current.current;
    if (open && active) {
      if (active.sourceAvailable === false || !active.file.size || active.error) {
        setMessage("Reconnect this photo’s source before preparing a social copy.");
      } else {
        setBusy(true);
        void (async () => {
          const bitmap = await decodeFile(active.file, 4096);
          try {
            if (operation !== sequence.current) return;
            const canvas = document.createElement("canvas");
            // Preserve existing Studio edit math; the C++ operator receives this exact edited copy.
            renderToCanvas(canvas, bitmap, active.edits, 4096, active.faces?.center);
            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(
                (value) =>
                  value ? resolve(value) : reject(new Error("Could not prepare the edited photo.")),
                "image/jpeg",
                0.96,
              ),
            );
            if (operation !== sequence.current) return;
            url = URL.createObjectURL(blob);
            setSource({ blob, url });
          } finally {
            bitmap.close();
          }
        })()
          .catch((error) => {
            if (operation === sequence.current)
              setMessage(error instanceof Error ? error.message : "Could not prepare this photo.");
          })
          .finally(() => {
            if (operation === sequence.current) setBusy(false);
          });
      }
    }
    return () => {
      invalidate();
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, key, shot?.file, clear, invalidate]);
  useEffect(
    () => () => {
      for (const item of outputs) URL.revokeObjectURL(item.url);
    },
    [outputs],
  );
  const change = (patch: Partial<SocialFrame>) => {
    clear();
    setFrame((previous) => ({ ...previous, ...patch }));
  };
  async function prepare() {
    if (!source || busy || !channels.length) return;
    clear();
    setBusy(true);
    const operation = sequence.current,
      abort = new AbortController();
    controller.current = abort;
    const prepared: Output[] = [];
    try {
      const cache = new Map<string, Blob>();
      for (const destination of destinations.filter((d) => channels.includes(d.id))) {
        setMessage(`Preparing ${destination.label}…`);
        const format =
          destination.id === "instagram" && frame.format === "square"
            ? "square"
            : destination.format;
        let blob = cache.get(format);
        if (!blob) {
          blob = await prepareSocialFrame(source.blob, { ...frame, format }, abort.signal);
          cache.set(format, blob);
        }
        if (operation !== sequence.current) return;
        prepared.push({
          id: destination.id,
          label: destination.label,
          blob,
          url: URL.createObjectURL(blob),
        });
      }
      setOutputs(prepared);
      setMessage("Prepared locally in C++. Nothing posted.");
    } catch (error) {
      if (operation === sequence.current)
        setMessage(error instanceof Error ? error.message : "Preparation failed. Nothing posted.");
    } finally {
      if (operation !== sequence.current || prepared.length !== channels.length)
        for (const item of prepared) URL.revokeObjectURL(item.url);
      if (operation === sequence.current) setBusy(false);
    }
  }
  async function download() {
    try {
      const snapshot = outputs;
      const entries = await Promise.all(
        snapshot.map(async (item) => ({
          path: `${item.id}.jpg`,
          bytes: new Uint8Array(await item.blob.arrayBuffer()),
        })),
      );
      if (snapshot !== outputRef.current) return;
      const url = URL.createObjectURL(
        makeZip([...entries, { path: "caption.txt", text: caption }]),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "lenslabs-social.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(
        "Download requested. The ZIP contains your social JPEGs and caption; nothing was posted.",
      );
    } catch {
      setMessage("Download could not be prepared. Your photo is unchanged.");
    }
  }
  async function share(item: Output) {
    const file = new File([item.blob], `${item.id}.jpg`, { type: "image/jpeg" });
    if (!navigator.canShare?.({ files: [file] })) {
      setMessage(
        "This browser cannot share photos to apps. Download the formats and add them in Instagram or Facebook.",
      );
      return;
    }
    try {
      await navigator.share({ files: [file], ...(caption ? { text: caption } : {}) });
      setMessage("Handed to your device’s share sheet. Posting is not confirmed by LensLabs.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.name === "AbortError"
          ? "Sharing cancelled. Nothing confirmed as posted."
          : "Could not open sharing. Download the formats instead.",
      );
    }
  }
  const previewOutput = outputs.find((item) =>
    frame.format === "story" ? item.id.includes("story") : item.id === "instagram",
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="social-export">
        <DialogTitle>Share to social</DialogTitle>
        <DialogDescription>
          Frame your edited photo once. Prepare posts and Stories together.
        </DialogDescription>
        <div className="social-export-layout">
          <div
            className="social-export-preview"
            style={{
              aspectRatio: `${SOCIAL_FORMATS[frame.format].width}/${SOCIAL_FORMATS[frame.format].height}`,
              maxWidth:
                (360 * SOCIAL_FORMATS[frame.format].width) / SOCIAL_FORMATS[frame.format].height,
              background: frame.background,
            }}
          >
            {source && (
              <img
                src={previewOutput?.url ?? source.url}
                alt={shot?.name ?? "Social preview"}
                style={
                  previewOutput
                    ? undefined
                    : {
                        objectFit: frame.mode === "fit" ? "contain" : "cover",
                        objectPosition: `${frame.x * 100}% ${frame.y * 100}%`,
                        transform: `scale(${frame.zoom})`,
                        transformOrigin: `${frame.x * 100}% ${frame.y * 100}%`,
                      }
                }
              />
            )}
            {frame.format === "story" && <div className="social-export-safe" aria-hidden="true" />}
          </div>
          <div className="social-export-controls">
            <fieldset disabled={busy}>
              <legend>Prepare for</legend>
              {destinations.map((d) => (
                <label className="social-export-channel" key={d.id}>
                  <input
                    type="checkbox"
                    checked={channels.includes(d.id)}
                    onChange={(event) => {
                      clear();
                      setChannels((previous) =>
                        event.target.checked
                          ? [...previous, d.id]
                          : previous.filter((id) => id !== d.id),
                      );
                    }}
                  />
                  {d.label}
                </label>
              ))}
            </fieldset>
            <label>
              Frame preview
              <select
                value={frame.format}
                disabled={busy}
                onChange={(event) =>
                  change({ format: event.target.value as SocialFrame["format"] })
                }
              >
                {Object.entries(SOCIAL_FORMATS).map(([id, value]) => (
                  <option key={id} value={id}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Framing
              <select
                value={frame.mode}
                disabled={busy}
                onChange={(event) =>
                  change({ mode: event.target.value as "fit" | "fill", zoom: 1 })
                }
              >
                <option value="fit">Fit whole photo</option>
                <option value="fill">Fill frame</option>
              </select>
            </label>
            {(["x", "y", "zoom"] as const).map((axis) => (
              <label key={axis}>
                {axis === "x" ? "Horizontal position" : axis === "y" ? "Vertical position" : "Zoom"}
                <Slider
                  aria-label={
                    axis === "x"
                      ? "Horizontal position"
                      : axis === "y"
                        ? "Vertical position"
                        : "Zoom"
                  }
                  value={[frame[axis]]}
                  min={axis === "zoom" ? 1 : 0}
                  max={axis === "zoom" ? 3 : 1}
                  step={0.01}
                  disabled={busy || (axis === "zoom" && frame.mode === "fit")}
                  onValueChange={(values) => change({ [axis]: values[0] })}
                />
              </label>
            ))}
            <label>
              Frame color
              <select
                value={frame.background}
                disabled={busy}
                onChange={(event) =>
                  change({ background: event.target.value as "black" | "white" })
                }
              >
                <option value="black">Black</option>
                <option value="white">White</option>
              </select>
            </label>
            <p className="social-export-note">
              Story guides mark a conservative text-safe area; they are not exported.
            </p>
          </div>
        </div>
        <label>
          Caption
          <textarea
            value={caption}
            maxLength={2200}
            rows={2}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Add your caption and hashtags"
          />
        </label>
        {message && (
          <p role="status" className="social-export-note">
            {message}
          </p>
        )}
        <div className="social-export-actions">
          <button
            className="social-export-primary"
            disabled={busy || !source || !channels.length}
            onClick={() => void prepare()}
          >
            {busy ? "Preparing…" : "Prepare formats"}
          </button>
          {busy && source && <button onClick={clear}>Cancel</button>}
          {!!outputs.length && <button onClick={() => void download()}>Download all</button>}
          {previewOutput && (
            <button onClick={() => void share(previewOutput)}>Share this format</button>
          )}
          <button
            onClick={() => {
              onOpenChange(false);
              void workbench?.openTool("/publish");
            }}
          >
            Connected accounts
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
