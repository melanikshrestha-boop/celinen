/** The unlearned half of the cull's taste: what a photographer tends to keep
 * before this photographer has said anything.
 *
 * There used to be a second, learned half here — a keep/reject memory in
 * localStorage, scored by nearest neighbours. It is gone, and preferences.ts
 * is the one learned path now, for three reasons:
 *
 *   1. A keep or a reject on its own is a weak label. Whether a frame is good
 *      depends on what it was up against, and a photographer who keeps eighty
 *      frames of a good game and eight of a bad one has not changed her taste.
 *      An override names two frames and says the engine ordered them wrongly,
 *      which is exactly the comparison a ranker needs.
 *   2. Both halves wrote to `reading.quality`. Two learners moving the same
 *      number in different directions is not two opinions, it is a bug that
 *      looks like indecision.
 *   3. The old memory kept ten raw measurements per sample. The log keeps the
 *      scoring heads, which is what every later model — pose, expression,
 *      aesthetic — will also speak, so nothing recorded today is wasted.
 *
 * What stays here is the prior: hand-written, identical for every
 * photographer, and never in competition with the log, because it does not
 * learn. A night portrait with a face is not "too dark". Maximum sharpness is
 * not the art.
 */
import type { CullReading } from "./engine";
import { readingHasFace } from "./portrait-face";

function clamp(value: number, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, value));
}

/** Mean red-minus-blue of the 4×4 grid: tungsten night is warm, open shade is cool. */
export function warmthOf(reading: CullReading): number {
  const color = reading.color;
  if (!color?.length) return 0;
  let r = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 2 < color.length; i += 3) {
    r += color[i]!;
    b += color[i + 2]!;
    n++;
  }
  return n ? clamp((r - b) / 255, -1, 1) : 0;
}

/** What this photographer tends to keep before there is any history: the
 * unlearned prior the learned ranker is mixed into. */
export function artfulPrior(reading: CullReading): number {
  const faced = readingHasFace(reading);
  let score = 0.5;
  if (faced) score += 0.18;
  else score -= 0.1;
  if (reading.eyesClosed) score -= 0.28;
  if (reading.globalSmear) score -= 0.14;
  const missed = reading.acuityBest - reading.acuitySubject;
  if (missed > 0.22) score -= 0.18;
  else if (faced && missed > 0.08) score += 0.05;
  if (faced && reading.subjectLuma >= 22 && reading.subjectLuma <= 130) score += 0.14;
  if (faced && reading.acuitySubject >= 0.28 && reading.acuitySubject < 0.58) score += 0.08;
  if (!faced && reading.acuitySubject < 0.26) score -= 0.2;
  if (!faced && reading.texture < 0.08) score -= 0.1;
  const dx = Math.abs(reading.subjectX - 0.5);
  if (faced && dx > 0.08 && dx < 0.3) score += 0.04;
  return clamp(score);
}

/** Rank the way a photographer does: a face in tungsten light beats a sharp empty wall. */
export function photographerQuality(reading: CullReading, keep: number): number {
  const faced = readingHasFace(reading);
  let q = reading.acuitySubject * 100;
  if (faced) q += 10;
  else q -= 8;
  if (reading.eyesClosed) q *= 0.45;
  if (reading.globalSmear) q *= 0.84;
  const missed = reading.acuityBest - reading.acuitySubject;
  if (missed > 0.22) q *= 0.72;
  else if (faced && missed > 0.08) q += 4;
  const luma = reading.subjectLuma;
  if (faced) {
    if (luma < 16) q *= 0.88;
    else if (luma <= 125) q += 7;
    if (luma > 242) q *= 0.7;
  } else {
    if (luma < 42) q *= 0.66;
    if (luma > 225) q *= 0.72;
    if (reading.texture < 0.08) q *= 0.75;
  }
  const dx = Math.abs(reading.subjectX - 0.5);
  if (faced && dx > 0.08 && dx < 0.3) q += 3;
  q *= 0.3 + 0.7 * keep;
  return Math.min(99, Math.max(1, q));
}
