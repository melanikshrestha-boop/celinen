/**
 * Interactive donut — Wonder Finances interaction:
 * cursor MOVE around the full disk updates the center. Rings stay still.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { money } from "./money";
import { pieSlicePath } from "./pieGeometry";

const COOL_POSITIVE = [
  "#2F9B7A",
  "#3D7EC4",
  "#2FA0A0",
  "#6B7FD4",
  "#4A9B8C",
  "#5B8FBF",
  "#3D8F6E",
  "#7B6FC4",
  "#45A8B8",
  "#5A9E78",
  "#6888C8",
  "#3A9A8A",
];

const WARM_NEGATIVE = [
  "#D45C48",
  "#E0A040",
  "#C45A72",
  "#E07A40",
  "#B85C8A",
  "#D4943A",
  "#C46850",
  "#A85868",
  "#D48858",
  "#C04050",
  "#B87840",
  "#D07068",
];

export type PiePalette = "payment" | "income" | "expense" | "net";

const INCOME_FIXED: Record<string, string> = {
  "Event coverage": "#2F9B7A",
  Licensing: "#3D7EC4",
  "Print sales": "#2FA0A0",
  Retainer: "#6B7FD4",
  "Other income": "#4A9B8C",
};

const EXPENSE_FIXED: Record<string, string> = {
  Advertising: "#D45C48",
  "Car & mileage": "#E0A040",
  "Contract labor (second shooter)": "#C45A72",
  Equipment: "#E07A40",
  Insurance: "#B85C8A",
  "Legal & professional": "#D4943A",
  "Office & supplies": "#C46850",
  "Rent (studio)": "#E0A040",
  "Software & subscriptions": "#A85868",
  Travel: "#D48858",
  Meals: "#C04050",
  Other: "#B87840",
};

export function sliceColor(label: string, index: number, palette: PiePalette = "income"): string {
  if (palette === "income") return INCOME_FIXED[label] ?? COOL_POSITIVE[index % COOL_POSITIVE.length]!;
  if (palette === "expense") return EXPENSE_FIXED[label] ?? WARM_NEGATIVE[index % WARM_NEGATIVE.length]!;
  if (palette === "net") return label === "Loss" ? "#D45C48" : "#2F9B7A";
  return COOL_POSITIVE[index % COOL_POSITIVE.length]!;
}

export type PieSlice = {
  label: string;
  amount: number;
  n?: number;
};

type Arc = {
  d: string;
  mid: number;
  frac: number;
  a0: number;
  a1: number;
  slice: PieSlice;
  color: string;
};

function sliceAtPointer(
  clientX: number,
  clientY: number,
  el: Element,
  size: number,
  cx: number,
  cy: number,
  rOuter: number,
  arcs: Arc[],
): number | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || arcs.length === 0) return null;

  const x = ((clientX - rect.left) / rect.width) * size;
  const y = ((clientY - rect.top) / rect.height) * size;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);

  if (dist > rOuter + 14) return null;
  if (dist < 0.5) return 0;

  let ang = Math.atan2(dy, dx);
  const start = -Math.PI / 2;
  while (ang < start) ang += 2 * Math.PI;
  while (ang >= start + 2 * Math.PI) ang -= 2 * Math.PI;

  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i]!;
    const last = i === arcs.length - 1;
    if (ang >= a.a0 - 1e-9 && (ang < a.a1 - 1e-9 || last)) return i;
  }
  return arcs.length - 1;
}

export function InteractivePie({
  slices,
  palette,
  title,
  centerTotal,
  size = 200,
}: {
  slices: PieSlice[];
  palette: PiePalette;
  title: string;
  centerTotal?: string;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const diskRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const arcsRef = useRef<Arc[]>([]);
  const rafRef = useRef<number | null>(null);
  const pendingPtr = useRef<{ x: number; y: number } | null>(null);

  const rows = useMemo(
    () => [...slices].filter((x) => x.amount > 0.0001).sort((a, b) => b.amount - a.amount),
    [slices],
  );
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const pad = 14;
  const R = size / 2 - pad;
  const rInner = R * 0.7;
  const CX = size / 2;
  const CY = size / 2;
  const holePct = Math.min(74, Math.max(40, ((rInner * 2 * 0.88) / size) * 100));
  const holePx = (holePct / 100) * size;
  const holeTextW = holePx * 0.74;

  const arcs: Arc[] = useMemo(() => {
    if (total <= 0) return [];
    let angle = -Math.PI / 2;
    return rows.map((s, i) => {
      const frac = s.amount / total;
      const a0 = angle;
      const a1 = angle + frac * 2 * Math.PI;
      angle = a1;
      const mid = (a0 + a1) / 2;
      const full = frac >= 0.999;
      const d = pieSlicePath(CX, CY, R, rInner, a0, a1, full);
      return {
        d,
        mid,
        frac,
        a0,
        a1,
        slice: s,
        color: sliceColor(s.label, i, palette),
      };
    });
  }, [rows, total, CX, CY, R, rInner, palette]);

  arcsRef.current = arcs;

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current || diskRef.current;
      if (!el) return;
      const next = sliceAtPointer(clientX, clientY, el, size, CX, CY, R, arcsRef.current);
      setHover((prev) => (prev === next ? prev : next));
    },
    [size, CX, CY, R],
  );

  const queueTrack = useCallback(
    (clientX: number, clientY: number) => {
      pendingPtr.current = { x: clientX, y: clientY };
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingPtr.current;
        if (p) applyPointer(p.x, p.y);
      });
    },
    [applyPointer],
  );

  useEffect(
    () => () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent | ReactMouseEvent) => {
      queueTrack(e.clientX, e.clientY);
    },
    [queueTrack],
  );

  const onLeave = useCallback(() => {
    pendingPtr.current = null;
    setHover(null);
  }, []);

  if (total <= 0 || rows.length === 0) {
    return (
      <div className="bk-panel bk-panel-tight">
        <h3 className="bk-panel-h">{title}</h3>
        <p className="bk-empty">—</p>
      </div>
    );
  }

  const hot = hover != null ? arcs[hover] : null;
  const holeMain = hot ? money(hot.slice.amount) : centerTotal || money(total);
  const charW = 0.55;
  const fitFs = (text: string, cap: number) => {
    const fit = (holeTextW * 0.92) / Math.max(1, text.length * charW);
    return Math.min(cap, Math.max(9, fit));
  };
  const mainFs = fitFs(holeMain, hot ? 17 : 16);

  return (
    <div className="bk-panel bk-panel-tight">
      <h3 className="bk-panel-h">{title}</h3>
      <div className="bk-pie-row">
        <div
          ref={diskRef}
          className="bk-pie-disk"
          style={{ width: size, height: size }}
          onPointerMove={onMove}
          onPointerEnter={onMove}
          onPointerLeave={onLeave}
          onMouseMove={onMove}
          onMouseEnter={onMove}
          onMouseLeave={onLeave}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${size} ${size}`}
            className="bk-pie-svg"
            role="img"
            aria-label={title}
            style={{ overflow: "visible" }}
            onPointerMove={onMove}
            onMouseMove={onMove}
            onPointerLeave={onLeave}
            onMouseLeave={onLeave}
          >
            {arcs.map((a, i) => {
              const isHot = hover === i;
              const dim = hover != null && !isHot;
              return (
                <path
                  key={`${a.slice.label}-${i}`}
                  d={a.d}
                  fill={a.color}
                  fillRule="evenodd"
                  className={isHot ? "bk-pie-slice is-hot" : dim ? "bk-pie-slice is-dim" : "bk-pie-slice"}
                  style={{
                    opacity: dim ? 0.22 : 1,
                    pointerEvents: "none",
                  }}
                  stroke={isHot ? "rgba(26,28,34,0.55)" : "rgba(247,247,250,0.95)"}
                  strokeWidth={isHot ? 2 : 1.35}
                  strokeLinejoin="round"
                />
              );
            })}
            <circle
              cx={CX}
              cy={CY}
              r={R + 12}
              fill="rgba(0,0,0,0.001)"
              style={{ cursor: "crosshair", pointerEvents: "all" }}
            />
          </svg>
          <div
            className={hot ? "bk-pie-hole is-hover" : "bk-pie-hole is-idle"}
            style={
              {
                width: `${holePct}%`,
                height: `${holePct}%`,
                ["--pie-fs-main"]: `${mainFs}px`,
              } as CSSProperties
            }
            aria-hidden
          >
            <span className="bk-pie-hole-main" title={holeMain}>
              {holeMain}
            </span>
          </div>
        </div>

        <ul className="bk-legend">
          {arcs.map((a, i) => {
            const pct = Math.round(a.frac * 100);
            const isHot = hover === i;
            const n = a.slice.n != null && a.slice.n > 0 ? a.slice.n : 1;
            return (
              <li
                key={`${a.slice.label}-${i}`}
                className={isHot ? "is-hot" : undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="k">
                  <i className="bk-swatch" style={{ background: a.color }} aria-hidden />
                  <span className="bk-legend-name">
                    {a.slice.label}&nbsp;({pct}%, n = {n})
                  </span>
                </span>
                <span className="v">{money(a.slice.amount)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
