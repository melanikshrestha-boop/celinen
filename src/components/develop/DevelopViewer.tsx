import { useEffect, useRef, useState, type ReactNode } from "react";
import { type DevelopSettings } from "@/lib/develop/contract";
import {
  defaultDevelopGeometry,
  UPRIGHT_MAX_GUIDES,
  type UprightGuide,
} from "@/lib/develop/upright";
import { UprightLoupe } from "./UprightLoupe";
import { type DevelopChange, type DevelopTool } from "./DevelopControls";
import { developImageReady } from "./develop-state";
import { type DevelopHistogramData } from "@/lib/develop/histogram";
import { analyzeDevelopBlob } from "@/lib/develop/pixel-analysis";
import { useDevelopPixelSample, type DevelopPixelSample } from "./useDevelopPixelSample";
import {
  developPixelCoordinate,
  readDevelopPixelSample,
} from "@/lib/develop/pixel-sample";

const ignorePixelSample = (_sample: DevelopPixelSample | null) => {};

export function DevelopViewer({
  url,
  blob,
  emptyLabel = "Choose a photograph to begin.",
  beforeUrl,
  beforeBlob,
  before,
  compare,
  zoom,
  grid,
  tool,
  settings,
  change,
  maskId,
  guide,
  onGuide,
  onDimensions,
  onHistogram,
  onHistogramError,
  knownHistogram,
  onPixelSample = ignorePixelSample,
  clipping,
  onWhiteBalancePick,
  overlay = null,
  exportFrame = null,
}: {
  url: string | null;
  blob: Blob | null;
  emptyLabel?: string;
  beforeUrl: string | null;
  beforeBlob: Blob | null;
  before: boolean;
  compare: boolean;
  zoom: "fit" | "100";
  grid: boolean;
  tool: DevelopTool;
  settings: DevelopSettings;
  change: DevelopChange;
  maskId: string | null;
  /** Index of the guide the photographer selected, for Backspace. */
  guide?: number | null;
  onGuide?: (index: number | null) => void;
  onDimensions: (w: number, h: number) => void;
  onHistogram: (histogram: DevelopHistogramData, url: string) => void;
  onHistogramError?: (message: string, url: string) => void;
  knownHistogram?: DevelopHistogramData | null;
  onPixelSample?: (sample: DevelopPixelSample | null) => void;
  clipping: { shadows: boolean; highlights: boolean };
  onWhiteBalancePick?: (sample: DevelopPixelSample) => void;
  /** Drawn over the stage, outside the photo's zoom and pan. */
  overlay?: ReactNode;
  /** Visible edit-mode border preview matching export night kit. */
  exportFrame?: { insetRatio: number; color: string } | null;
}) {
  const stage = useRef<HTMLDivElement>(null),
    sampleImage = useRef<HTMLImageElement>(null),
    uneditedImage = useRef<HTMLImageElement>(null),
    gesture = useRef<{ x: number; y: number; settings: DevelopSettings } | null>(null);
  const latest = useRef(settings);
  const clippingCanvas = useRef<HTMLCanvasElement>(null);
  const [clippedOwner, setClippedOwner] = useState<{
    url: string;
    shadows: boolean;
    highlights: boolean;
  } | null>(null);
  latest.current = settings;
  // While a guide is being drawn: its two ends in normalized image coordinates.
  const [drawing, setDrawing] = useState<UprightGuide | null>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 500 }),
    [imageSize, setImageSize] = useState({ width: 4, height: 3 }),
    [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const displayedUrl = before && beforeUrl ? beforeUrl : url,
    displayedBlob = before && beforeUrl ? beforeBlob : blob,
    geometryReady = developImageReady(loadedUrl, displayedUrl);
  const pixelPointer = useDevelopPixelSample({
    image: sampleImage,
    sourceUrl: displayedUrl,
    enabled: geometryReady && (tool === "edit" || tool === "wb") && !compare,
    onSample: onPixelSample,
  });
  useEffect(() => {
    if (!displayedBlob || !displayedUrl) return;
    if (knownHistogram) {
      onHistogram(knownHistogram, displayedUrl);
      return;
    }
    const controller = new AbortController();
    void analyzeDevelopBlob(displayedBlob, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) onHistogram(result.histogram, displayedUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          onHistogramError?.(
            error instanceof Error ? error.message : "Pixel analysis failed",
            displayedUrl,
          );
      });
    return () => controller.abort();
  }, [displayedBlob, displayedUrl, knownHistogram, onHistogram, onHistogramError]);
  useEffect(() => {
    const canvas = clippingCanvas.current;
    const releaseCanvas = () => {
      if (canvas) canvas.width = canvas.height = 0;
    };
    setClippedOwner(null);
    // Hiding a 36MP overlay does not free its ~144 MB RGBA backing store.
    releaseCanvas();
    if (!canvas || !displayedBlob || !displayedUrl || (!clipping.shadows && !clipping.highlights))
      return;
    const controller = new AbortController();
    void analyzeDevelopBlob(displayedBlob, {
      signal: controller.signal,
      clipping: { shadows: clipping.shadows, highlights: clipping.highlights },
    })
      .then((result) => {
        if (controller.signal.aborted || !result.clipping) return;
        canvas.width = result.width;
        canvas.height = result.height;
        const context = canvas.getContext("2d");
        if (!context) {
          releaseCanvas();
          return;
        }
        context.putImageData(new ImageData(result.clipping, result.width, result.height), 0, 0);
        setClippedOwner({
          url: displayedUrl,
          shadows: clipping.shadows,
          highlights: clipping.highlights,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          releaseCanvas();
          onHistogramError?.(
            error instanceof Error ? error.message : "Clipping analysis failed",
            displayedUrl,
          );
        }
      });
    return () => {
      controller.abort();
      releaseCanvas();
    };
  }, [displayedBlob, clipping.shadows, clipping.highlights, displayedUrl, onHistogramError]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const resize = () => setBounds({ width: el.clientWidth - 40, height: el.clientHeight - 40 });
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, []);
  const scale =
    zoom === "100"
      ? 1
      : Math.min(
          bounds.width / (compare ? 2 : 1) / imageSize.width,
          bounds.height / imageSize.height,
          1,
        );
  const width = Math.max(1, imageSize.width * scale),
    height = Math.max(1, imageSize.height * scale);
  const mask = settings.masks.find((m) => m.id === maskId) ?? settings.masks[0];
  const geometry = settings.geometry ?? defaultDevelopGeometry();
  const guides = geometry.guides;
  const setGuides = (next: UprightGuide[], commit: boolean) => {
    latest.current = { ...latest.current, geometry: { ...geometry, guides: next, solved: null } };
    change(latest.current, "Upright guides", commit);
  };
  // Distance from a point to a guide, in normalized units, for selection.
  const guideDistance = (g: UprightGuide, x: number, y: number) => {
    const dx = g.x2 - g.x1,
      dy = g.y2 - g.y1;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - g.x1) * dx + (y - g.y1) * dy) / length)) : 0;
    return Math.hypot(x - (g.x1 + t * dx), y - (g.y1 + t * dy));
  };
  const frameInset = exportFrame
    ? Math.max(2, Math.round(Math.max(width, height) * exportFrame.insetRatio))
    : 0;
  const frameStyle = exportFrame
    ? {
        width: width + frameInset * 2,
        height: height + frameInset * 2,
        padding: frameInset,
        background: exportFrame.color,
        boxSizing: "border-box" as const,
      }
    : { width, height };
  return (
    <div
      className={`develop-stage ${zoom === "100" ? "is-zoomed" : ""}`}
      ref={stage}
      aria-label="Photo preview"
    >
      {url ? (
        <div className="develop-compare-pair">
          {compare && beforeUrl && (
            <div className="develop-image-frame" style={frameStyle}>
              <img src={beforeUrl} alt="Before adjustments" style={exportFrame ? { width, height } : undefined} />
              <span className="develop-image-label">Before</span>
            </div>
          )}
          <div
            className={`develop-image-frame${exportFrame ? " has-export-border" : ""}`}
            style={{ ...frameStyle, cursor: tool === "wb" ? "crosshair" : undefined }}
            {...pixelPointer}
            onPointerDown={(event) => {
              if (tool !== "wb" || event.button !== 0 || !onWhiteBalancePick) return;
              const visible = sampleImage.current;
              if (!visible?.complete) return;
              const point = developPixelCoordinate(
                event.clientX,
                event.clientY,
                visible.getBoundingClientRect(),
                visible.naturalWidth,
                visible.naturalHeight,
              );
              if (!point) return;
              const source =
                uneditedImage.current?.complete && uneditedImage.current.naturalWidth
                  ? uneditedImage.current
                  : visible;
              const mapped = {
                x: Math.min(
                  source.naturalWidth - 1,
                  Math.floor((point.x / visible.naturalWidth) * source.naturalWidth),
                ),
                y: Math.min(
                  source.naturalHeight - 1,
                  Math.floor((point.y / visible.naturalHeight) * source.naturalHeight),
                ),
              };
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d", {
                colorSpace: "srgb",
                willReadFrequently: true,
              });
              if (!context) return;
              event.preventDefault();
              onWhiteBalancePick(readDevelopPixelSample(source, context, mapped));
            }}
          >
            <img
              ref={sampleImage}
              src={displayedUrl ?? undefined}
              alt={before ? "Before adjustments" : "Developed photo"}
              draggable={false}
              style={exportFrame ? { width, height } : undefined}
              onError={(e) => {
                e.currentTarget.removeAttribute("src");
              }}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.currentSrc !== displayedUrl) return;
                setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
                setLoadedUrl(displayedUrl);
                onDimensions(img.naturalWidth, img.naturalHeight);
              }}
            />
            {beforeUrl && beforeUrl !== displayedUrl && (
              <img ref={uneditedImage} src={beforeUrl} alt="" hidden />
            )}
            <canvas
              ref={clippingCanvas}
              className="develop-clipping-overlay"
              aria-hidden="true"
              style={{
                display:
                  geometryReady &&
                  clippedOwner?.url === displayedUrl &&
                  clippedOwner.shadows === clipping.shadows &&
                  clippedOwner.highlights === clipping.highlights &&
                  (clipping.shadows || clipping.highlights)
                    ? "block"
                    : "none",
              }}
            />
            {drawing && displayedUrl && (
              <UprightLoupe
                url={displayedUrl}
                x={drawing.x2}
                y={drawing.y2}
                width={width}
                height={height}
              />
            )}
            {compare && <span className="develop-image-label">After</span>}
            {(grid || tool === "crop") && <div className="develop-grid" aria-hidden="true" />}
            {(tool === "crop" || tool === "mask" || tool === "guided") && !before && !compare && (
              <svg
                className="develop-overlay"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                role="img"
                data-geometry-ready={geometryReady}
                style={{
                  visibility: geometryReady ? "visible" : "hidden",
                  pointerEvents: geometryReady ? "auto" : "none",
                }}
                aria-label={
                  tool === "crop"
                    ? "Drag on the source photo to draw crop bounds"
                    : tool === "guided"
                      ? "Drag along a line that should be straight"
                      : "Drag to position the selected mask"
                }
                onPointerDown={(e) => {
                  if (!geometryReady || e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = (e.clientX - r.left) / r.width,
                    y = (e.clientY - r.top) / r.height;
                  if (tool === "guided") {
                    // Tapping an existing guide selects it; Backspace removes it.
                    const near = guides
                      .map((g, index) => ({ index, distance: guideDistance(g, x, y) }))
                      .sort((a, b) => a.distance - b.distance)[0];
                    if (near && near.distance < 0.02) {
                      onGuide?.(near.index);
                      return;
                    }
                    if (guides.length >= UPRIGHT_MAX_GUIDES) return;
                    onGuide?.(null);
                    setDrawing({ x1: x, y1: y, x2: x, y2: y });
                    e.currentTarget.setPointerCapture(e.pointerId);
                    return;
                  }
                  gesture.current = {
                    x,
                    y,
                    settings: structuredClone(settings),
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const g = gesture.current;
                  if ((!g && !drawing) || !geometryReady) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                    y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
                  if (drawing) {
                    setDrawing({ ...drawing, x2: x, y2: y });
                    return;
                  }
                  if (!g) return;
                  if (tool === "crop") {
                    const w = Math.max(0.01, Math.abs(x - g.x)),
                      h = Math.max(0.01, Math.abs(y - g.y));
                    const c = {
                      ...g.settings.crop,
                      x: Math.min(1 - w, Math.min(x, g.x)),
                      y: Math.min(1 - h, Math.min(y, g.y)),
                      width: w,
                      height: h,
                    };
                    latest.current = { ...latest.current, crop: c };
                    change(latest.current, "Crop", false);
                  } else if (mask) {
                    latest.current = {
                      ...latest.current,
                      masks: latest.current.masks.map((m) =>
                        m.id === mask.id ? { ...m, x, y } : m,
                      ),
                    };
                    change(latest.current, "Position mask", false);
                  }
                }}
                onPointerUp={() => {
                  if (drawing) {
                    // A tap is not a guide: it must span some of the frame.
                    if (Math.hypot(drawing.x2 - drawing.x1, drawing.y2 - drawing.y1) > 0.03) {
                      // The Upright measurement commits this step.
                      setGuides([...guides, drawing], false);
                      onGuide?.(guides.length);
                    }
                    setDrawing(null);
                    return;
                  }
                  if (gesture.current)
                    change(latest.current, tool === "crop" ? "Crop" : "Position mask", true);
                  gesture.current = null;
                }}
                onPointerCancel={() => {
                  if (drawing) {
                    setDrawing(null);
                    return;
                  }
                  gesture.current = null;
                  change(latest.current, "Geometry", true);
                }}
                onLostPointerCapture={() => {
                  if (drawing) setDrawing(null);
                  if (gesture.current) {
                    gesture.current = null;
                    change(latest.current, tool === "crop" ? "Crop" : "Position mask", true);
                  }
                }}
              >
                {tool === "guided" ? (
                  <>
                    {[
                      ...guides.map((g, index) => ({ g, index })),
                      ...(drawing ? [{ g: drawing, index: -1 }] : []),
                    ].map(({ g, index }) => (
                      <g key={index} className="develop-guide" aria-hidden="true">
                        <line
                          x1={g.x1 * 1000}
                          y1={g.y1 * 1000}
                          x2={g.x2 * 1000}
                          y2={g.y2 * 1000}
                          stroke={index === guide ? "#ffd479" : "#8fd0ff"}
                          strokeWidth={index === guide ? 3 : 2}
                          vectorEffect="non-scaling-stroke"
                        />
                        {[
                          [g.x1, g.y1],
                          [g.x2, g.y2],
                        ].map(([x, y], end) => (
                          <circle
                            key={end}
                            cx={x! * 1000}
                            cy={y! * 1000}
                            r="5"
                            fill={index === guide ? "#ffd479" : "#8fd0ff"}
                            stroke="#111"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </g>
                    ))}
                  </>
                ) : tool === "crop" ? (
                  <>
                    <path
                      d={`M0 0H1000V1000H0Z M${settings.crop.x * 1000} ${settings.crop.y * 1000}v${settings.crop.height * 1000}h${settings.crop.width * 1000}v${-settings.crop.height * 1000}Z`}
                      fill="rgba(0,0,0,.5)"
                      fillRule="evenodd"
                    />
                    <rect
                      x={settings.crop.x * 1000}
                      y={settings.crop.y * 1000}
                      width={settings.crop.width * 1000}
                      height={settings.crop.height * 1000}
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : (
                  mask && (
                    <g
                      transform={`translate(${mask.x * 1000} ${mask.y * 1000}) rotate(${mask.angle})`}
                    >
                      {mask.type === "radial" ? (
                        <ellipse
                          rx={mask.radius * 1000}
                          ry={(mask.radius * 1000) / mask.aspect}
                          fill="rgba(220,93,93,.12)"
                          stroke="#efb1b1"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (
                        <>
                          <path
                            d={`M0 -1200V1200 M${mask.radius * (mask.feather + 0.01) * 500} -1200V1200 M${-mask.radius * (mask.feather + 0.01) * 500} -1200V1200`}
                            fill="none"
                            stroke="#efb1b1"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                          />
                        </>
                      )}
                      <circle
                        r="9"
                        fill="white"
                        stroke="#222"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )
                )}
              </svg>
            )}
          </div>
        </div>
      ) : (
        <p className="develop-hint">{emptyLabel}</p>
      )}
      {overlay}
    </div>
  );
}
