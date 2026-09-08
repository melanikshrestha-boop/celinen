import { useEffect, useRef, useState } from "react";
import { type DevelopSettings } from "@/lib/develop/contract";
import { type DevelopChange, type DevelopTool } from "./DevelopControls";
import { developImageReady } from "./develop-state";
import {
  analyzeDevelopPixels,
  clippingPixels,
  type DevelopHistogramData,
} from "@/lib/develop/histogram";

export function DevelopViewer({
  url,
  emptyLabel = "Choose a photograph to begin.",
  beforeUrl,
  before,
  compare,
  zoom,
  grid,
  tool,
  settings,
  change,
  maskId,
  onDimensions,
  onHistogram,
  clipping,
}: {
  url: string | null;
  emptyLabel?: string;
  beforeUrl: string | null;
  before: boolean;
  compare: boolean;
  zoom: "fit" | "100";
  grid: boolean;
  tool: DevelopTool;
  settings: DevelopSettings;
  change: DevelopChange;
  maskId: string | null;
  onDimensions: (w: number, h: number) => void;
  onHistogram: (histogram: DevelopHistogramData) => void;
  clipping: { shadows: boolean; highlights: boolean };
}) {
  const stage = useRef<HTMLDivElement>(null),
    gesture = useRef<{ x: number; y: number; settings: DevelopSettings } | null>(null);
  const latest = useRef(settings);
  const clippingCanvas = useRef<HTMLCanvasElement>(null);
  const [pixels, setPixels] = useState<{ url: string; image: ImageData } | null>(null);
  latest.current = settings;
  const [bounds, setBounds] = useState({ width: 640, height: 500 }),
    [imageSize, setImageSize] = useState({ width: 4, height: 3 }),
    [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const displayedUrl = before && beforeUrl ? beforeUrl : url,
    geometryReady = developImageReady(loadedUrl, displayedUrl);
  useEffect(() => {
    const canvas = clippingCanvas.current;
    if (!canvas || !pixels || pixels.url !== displayedUrl) return;
    canvas.width = pixels.image.width;
    canvas.height = pixels.image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!clipping.shadows && !clipping.highlights) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.putImageData(
      new ImageData(
        clippingPixels(pixels.image.data, clipping.shadows, clipping.highlights),
        pixels.image.width,
        pixels.image.height,
      ),
      0,
      0,
    );
  }, [pixels, clipping.shadows, clipping.highlights, displayedUrl]);
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
  return (
    <div
      className={`develop-stage ${zoom === "100" ? "is-zoomed" : ""}`}
      ref={stage}
      aria-label="Photo preview"
    >
      {url ? (
        <div className="develop-compare-pair">
          {compare && beforeUrl && (
            <div className="develop-image-frame" style={{ width, height }}>
              <img src={beforeUrl} alt="Before adjustments" />
              <span className="develop-image-label">Before</span>
            </div>
          )}
          <div className="develop-image-frame" style={{ width, height }}>
            <img
              src={displayedUrl ?? undefined}
              alt={before ? "Before adjustments" : "Developed photo"}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.currentSrc !== displayedUrl) return;
                setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
                setLoadedUrl(displayedUrl);
                onDimensions(img.naturalWidth, img.naturalHeight);
                const c = document.createElement("canvas");
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext("2d");
                if (!ctx) return;
                ctx.drawImage(img, 0, 0, c.width, c.height);
                const image = ctx.getImageData(0, 0, c.width, c.height);
                setPixels({ url: displayedUrl!, image });
                onHistogram(analyzeDevelopPixels(image.data));
              }}
            />
            <canvas
              ref={clippingCanvas}
              className="develop-clipping-overlay"
              aria-hidden="true"
              style={{
                display:
                  pixels?.url === displayedUrl && (clipping.shadows || clipping.highlights)
                    ? "block"
                    : "none",
              }}
            />
            {compare && <span className="develop-image-label">After</span>}
            {(grid || tool === "crop") && <div className="develop-grid" aria-hidden="true" />}
            {(tool === "crop" || tool === "mask") && !before && !compare && (
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
                    : "Drag to position the selected mask"
                }
                onPointerDown={(e) => {
                  if (!geometryReady || e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  gesture.current = {
                    x: (e.clientX - r.left) / r.width,
                    y: (e.clientY - r.top) / r.height,
                    settings: structuredClone(settings),
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const g = gesture.current;
                  if (!g || !geometryReady) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                    y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
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
                  if (gesture.current)
                    change(latest.current, tool === "crop" ? "Crop" : "Position mask", true);
                  gesture.current = null;
                }}
                onPointerCancel={() => {
                  gesture.current = null;
                  change(latest.current, "Geometry", true);
                }}
                onLostPointerCapture={() => {
                  if (gesture.current) {
                    gesture.current = null;
                    change(latest.current, tool === "crop" ? "Crop" : "Position mask", true);
                  }
                }}
              >
                {tool === "crop" ? (
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
    </div>
  );
}
