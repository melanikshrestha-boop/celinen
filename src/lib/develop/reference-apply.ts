import { cloneDevelopSettings, type DevelopSettings } from "./contract";

/** A neutral-based reference fit replaces global treatment, not the user's detail work. */
export function applyReferenceLook(
  current: DevelopSettings,
  fitted: DevelopSettings,
): DevelopSettings {
  return cloneDevelopSettings({
    ...fitted,
    sharpening: current.sharpening,
    noiseReduction: current.noiseReduction,
    colorNoiseReduction: current.colorNoiseReduction,
    grain: current.grain,
    grainSize: current.grainSize,
    grainLuminance: current.grainLuminance,
    crop: current.crop,
    masks: current.masks,
  });
}
