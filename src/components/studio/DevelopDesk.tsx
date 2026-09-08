import type { RefObject } from "react";
import type { Edits, Shot } from "@/lib/imaging";
import { DEFAULT_EDITS } from "@/lib/imaging";
import { EditSlider } from "./Slider";
import { Filmstrip } from "./Filmstrip";
import "./develop-desk.css";

export type DevelopPane = "library" | "develop";
export type DevelopSection = "basic" | "color" | "bw";

const LOOKS: { id: string; name: string; swatch: string; edits?: Partial<Edits> }[] = [
  { id: "original", name: "Original", swatch: "#888", edits: DEFAULT_EDITS },
  { id: "auto", name: "Auto", swatch: "#c4a574" },
  { id: "warm", name: "Warm", swatch: "#d4a574", edits: { temp: 28, saturation: 10 } },
  { id: "cool", name: "Cool", swatch: "#7aa0c4", edits: { temp: -24, saturation: 4 } },
  { id: "contrast", name: "Contrast", swatch: "#bbb", edits: { contrast: 26, highlights: -12, shadows: 10 } },
  { id: "fade", name: "Fade", swatch: "#9a9088", edits: { contrast: -16, shadows: 22, highlights: 8 } },
  { id: "bw", name: "B & W", swatch: "#ccc", edits: { saturation: -100 } },
];

export function DevelopDesk({
  pane,
  onPane,
  selected,
  visible,
  selectedId,
  onSelect,
  canvasRef,
  loupeStatus,
  bins,
  section,
  onSection,
  showBefore,
  onBefore,
  onLook,
  onCopy,
  onPaste,
  onPrevious,
  onReset,
  canPaste,
  onEdit,
  onEditStart,
}: {
  pane: DevelopPane;
  onPane: (pane: DevelopPane) => void;
  selected: Shot | null;
  visible: Shot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  loupeStatus: "loading" | "ready" | "failed";
  bins: number[];
  section: DevelopSection;
  onSection: (section: DevelopSection) => void;
  showBefore: boolean;
  onBefore: (on: boolean) => void;
  onLook: (id: string) => void;
  onCopy: () => void;
  onPaste: () => void;
  onPrevious: () => void;
  onReset: () => void;
  canPaste: boolean;
  onEdit: (patch: Partial<Edits>) => void;
  onEditStart: () => void;
}) {
  const edits = selected?.edits ?? DEFAULT_EDITS;
  const activeLook =
    LOOKS.find((look) => look.edits && lookMatches(edits, look.edits))?.id ??
    (edits.saturation === -100 ? "bw" : null);

  return (
    <div className="lr-desk">
      <div className="lr-top">
        <button type="button" className={pane === "library" ? "is-on" : ""} onClick={() => onPane("library")}>
          Library
        </button>
        <button type="button" className={pane === "develop" ? "is-on" : ""} onClick={() => onPane("develop")}>
          Develop
        </button>
      </div>

      <aside className="lr-left">
        <div className="lr-nav">
          <p className="lr-nav-label">Navigator</p>
          <div className="lr-nav-frame">
            {selected?.previewUrl ? (
              <img src={selected.previewUrl} alt="" />
            ) : (
              <span />
            )}
          </div>
        </div>
        <div className="lr-looks" role="list" aria-label="Looks">
          {LOOKS.map((look) => (
            <button
              key={look.id}
              type="button"
              className={`lr-look ${activeLook === look.id ? "is-on" : ""}`}
              onClick={() => onLook(look.id)}
            >
              <i style={{ background: look.swatch }} />
              {look.name}
            </button>
          ))}
        </div>
        <div className="lr-look-actions">
          <button type="button" onClick={onCopy} disabled={!selected}>
            Copy
          </button>
          <button type="button" onClick={onPaste} disabled={!canPaste || !selected}>
            Paste
          </button>
        </div>
      </aside>

      <div className="lr-stage">
        {selected?.error ? (
          <p>{selected.error}</p>
        ) : (
          <canvas
            ref={canvasRef}
            className={loupeStatus === "ready" ? "" : "invisible"}
          />
        )}
        {loupeStatus !== "ready" && !selected?.error && (
          <p>{loupeStatus === "loading" ? "Rendering photo…" : "Preview unavailable."}</p>
        )}
        <div className="lr-stage-tools">
          <label>
            <input
              type="checkbox"
              checked={showBefore}
              onChange={(event) => onBefore(event.target.checked)}
            />
            Before
          </label>
        </div>
      </div>

      <aside className="lr-right">
        <div className="lr-hist" aria-label="Histogram">
          {bins.map((bin, i) => (
            <span key={i} style={{ height: `${Math.max(2, bin * 100)}%` }} />
          ))}
        </div>
        <div className="lr-tabs">
          {(["basic", "color", "bw"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={section === id ? "is-on" : ""}
              onClick={() => onSection(id)}
            >
              {id === "basic" ? "Basic" : id === "color" ? "Color" : "B & W"}
            </button>
          ))}
        </div>
        {section === "basic" && (
          <>
            <p className="lr-group">Tone</p>
            <EditSlider label="Exposure" value={edits.exposure} onChangeStart={onEditStart} onChange={(v) => onEdit({ exposure: v })} />
            <EditSlider label="Contrast" value={edits.contrast} onChangeStart={onEditStart} onChange={(v) => onEdit({ contrast: v })} />
            <EditSlider label="Highlights" value={edits.highlights} onChangeStart={onEditStart} onChange={(v) => onEdit({ highlights: v })} />
            <EditSlider label="Shadows" value={edits.shadows} onChangeStart={onEditStart} onChange={(v) => onEdit({ shadows: v })} />
          </>
        )}
        {section === "color" && (
          <>
            <p className="lr-group">WB</p>
            <EditSlider label="Temp" value={edits.temp} onChangeStart={onEditStart} onChange={(v) => onEdit({ temp: v })} />
            <EditSlider label="Saturation" value={edits.saturation} onChangeStart={onEditStart} onChange={(v) => onEdit({ saturation: v })} />
          </>
        )}
        {section === "bw" && (
          <>
            <p className="lr-group">B & W</p>
            <EditSlider
              label="Saturation"
              value={edits.saturation}
              min={-100}
              max={0}
              onChangeStart={onEditStart}
              onChange={(v) => onEdit({ saturation: v })}
            />
          </>
        )}
        <div className="lr-right-actions">
          <button type="button" onClick={onPrevious} disabled={!selected}>
            Previous
          </button>
          <button type="button" onClick={onReset} disabled={!selected}>
            Reset
          </button>
        </div>
      </aside>

      <div className="lr-strip">
        <Filmstrip shots={visible} selectedId={selectedId} onSelect={onSelect} compact numbered />
      </div>
    </div>
  );
}

function lookMatches(edits: Edits, partial: Partial<Edits>) {
  return (Object.keys(partial) as (keyof Edits)[]).every((key) => edits[key] === partial[key]);
}
