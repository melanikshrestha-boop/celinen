import { cloneDevelopSettings, type DevelopSettings } from "./contract";
import {
  histogramPercentile,
  srgbToLinear,
  suggestDevelopTone,
  type DevelopHistogramData,
} from "./histogram";

/** Add a bounded lighting correction without overwriting the photographer's look.
 * This is a source-preview heuristic, not scene understanding or Adobe Auto.
 */
export function adaptPresetToLight(settings: DevelopSettings, stats: DevelopHistogramData) {
  const result = cloneDevelopSettings(settings);
  const tone = suggestDevelopTone(stats);
  let adjustment = tone.applicable ? tone.exposure : 0;
  if (adjustment > 0) {
    const upper = srgbToLinear(histogramPercentile(stats.maximum, 0.995));
    const headroom = upper > 0 ? Math.log2(0.98 / upper) : 0;
    adjustment = Math.min(adjustment, Math.max(0, headroom - settings.exposure));
    adjustment = Math.floor(adjustment * 100 + 1e-9) / 100;
  }
  result.exposure =
    Math.round(Math.min(5, Math.max(-5, settings.exposure + adjustment)) * 100) / 100;
  return { settings: result, adjustment: result.exposure - settings.exposure, reason: tone.reason };
}
