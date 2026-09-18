import type { NormalizedRect } from "@/lib/studio/cull/ingest-engine";
import type { CullFrame } from "@/lib/studio/cull/session";
import { focusSummary } from "./cull-review";

/** Positions a normalized rectangle over the drawn image (CullLoupePicture's variables). */
function place(rect: NormalizedRect) {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp(rect.x);
  const y = clamp(rect.y);
  return {
    left: `calc(var(--cull-img-x) + var(--cull-img-w) * ${x})`,
    top: `calc(var(--cull-img-y) + var(--cull-img-h) * ${y})`,
    width: `calc(var(--cull-img-w) * ${clamp(rect.w) || 0.01})`,
    height: `calc(var(--cull-img-h) * ${clamp(rect.h) || 0.01})`,
  };
}

/**
 * The camera's AF area drawn on the photo, colored by whether focus landed
 * there. When it did not, the sharpest detail in the frame is outlined too, so
 * the photographer sees at a glance what the camera focused on instead.
 */
export function CullAfBox({ frame }: { frame: CullFrame }) {
  const af = frame.afPoint;
  if (!af) return null;
  const verdict = frame.focusHit?.verdict ?? "unjudged";
  const elsewhere =
    frame.focusHit && (verdict === "front-or-back-focus" || verdict === "missed")
      ? frame.focusHit.bestRegion
      : null;
  return (
    <>
      {elsewhere && elsewhere.w > 0 && (
        <span className="cull-af cull-af-best" aria-hidden="true" style={place(elsewhere)} />
      )}
      <span
        className="cull-af"
        data-verdict={verdict}
        role="img"
        aria-label={focusSummary(frame) ?? "AF area"}
        style={place(af)}
      />
    </>
  );
}
