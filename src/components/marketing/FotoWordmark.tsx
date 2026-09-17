import { IrisGlyph } from "@/components/lensos/Logo";

/** Cap line 32 / baseline 120 for f-stem, t-stem, and both irises. Hook sits above. */
const ASC = 32;
const BASE = 120;
const BAR_F = 72;
const BAR_T = 50;
const STEM = BASE - ASC;
const IRIS_R = (BASE - ASC) / 2;
const IRIS_CY = (ASC + BASE) / 2;
const IRIS_SCALE = IRIS_R / 14.2;
const F_STEM = 50;
const O1 = 154;
const T_STEM = 242;
const O2 = 332;

function IrisO({ cx }: { cx: number }) {
  return (
    <g transform={`translate(${cx} ${IRIS_CY}) scale(${IRIS_SCALE}) translate(-16 -16)`}>
      <IrisGlyph />
    </g>
  );
}

/** Public Celinen mark: a normal f and t, the o’s are the iris. */
export function FotoWordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`celinen-wordmark ${className}`.trim()}
      viewBox="0 0 396 150"
      fill="none"
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={`M${F_STEM} 34C${F_STEM} 14 74 12 82 32`} />
        <path d={`M${F_STEM} ${ASC}v${STEM}`} />
        <path d={`M30 ${BAR_F}h48`} />
        <path d={`M${T_STEM} ${ASC}v${STEM}`} />
        <path d={`M225 ${BAR_T}h34`} />
      </g>
      <IrisO cx={O1} />
      <IrisO cx={O2} />
    </svg>
  );
}
