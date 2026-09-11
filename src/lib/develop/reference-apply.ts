import { cloneDevelopSettings, type DevelopSettings } from "./contract";

/** A neutral-based reference fit replaces global treatment, not the user's detail work. */
export function applyReferenceLook(
  current: DevelopSettings,
  fitted: DevelopSettings,
): DevelopSettings {
  return cloneDevelopSettings({
    // Fitted curve points and their interpolation travel together. Keeping a previous
    // Smooth mode on a Linear fit would invalidate its measured residual/preview.
    ...fitted,
    sharpening: current.sharpening,
    sharpeningRadius: current.sharpeningRadius,
    sharpeningDetail: current.sharpeningDetail,
    sharpeningMasking: current.sharpeningMasking,
    noiseReduction: current.noiseReduction,
    colorNoiseReduction: current.colorNoiseReduction,
    grain: current.grain,
    grainSize: current.grainSize,
    grainLuminance: current.grainLuminance,
    crop: current.crop,
    masks: current.masks,
  });
}
