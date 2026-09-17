/** Upright (Transform) settings: what the photographer chose, and what the C++
 * engine measured for this photo. Stored in the recipe so a render never has to
 * re-detect lines: preview, export and the local executable all warp from the
 * same solved numbers (native/include/lenslabs/upright.hpp).
 */
import { z } from "zod";

export const UPRIGHT_MODES = ["off", "auto", "level", "vertical", "full", "guided"] as const;
export type UprightMode = (typeof UPRIGHT_MODES)[number];
/** Engine enum order (lenslabs::UprightMode). */
const MODE_CODE: Record<UprightMode, number> = {
  off: 0,
  auto: 1,
  level: 2,
  vertical: 3,
  full: 4,
  guided: 5,
};
export const UPRIGHT_MAX_GUIDES = 4;

const unit = z.number().finite().min(0).max(1);
const signed = z.number().finite().min(-100).max(100);
const angle = z.number().finite().min(-45).max(45);

export const uprightGuideSchema = z.object({ x1: unit, y1: unit, x2: unit, y2: unit }).strict();
export type UprightGuide = z.infer<typeof uprightGuideSchema>;

export const uprightSolutionSchema = z
  .object({
    /** The mode this was solved for; a different current mode makes it stale. */
    mode: z.enum(UPRIGHT_MODES),
    /** What the evidence supported (Level when verticals were too weak). */
    applied: z.enum(UPRIGHT_MODES),
    fallback: z.boolean(),
    roll: angle,
    pitch: angle,
    yaw: angle,
    /** Focal length as a fraction of the image diagonal. */
    focal: z.number().finite().min(0.2).max(10),
    focalSource: z.enum(["default", "exif", "sensor", "measured", "guided"]),
    confidence: unit,
    /** Guides the Guided solve used, so edited guides are never rendered stale. */
    guides: z.array(uprightGuideSchema).max(UPRIGHT_MAX_GUIDES),
  })
  .strict();
export type UprightSolution = z.infer<typeof uprightSolutionSchema>;

export const developGeometrySchema = z
  .object({
    upright: z.enum(UPRIGHT_MODES),
    vertical: signed,
    horizontal: signed,
    rotate: z.number().finite().min(-10).max(10),
    aspect: signed,
    scale: z.number().finite().min(50).max(150),
    xOffset: signed,
    yOffset: signed,
    constrainCrop: z.boolean(),
    guides: z.array(uprightGuideSchema).max(UPRIGHT_MAX_GUIDES),
    solved: uprightSolutionSchema.nullable(),
  })
  .strict();
export type DevelopGeometry = z.infer<typeof developGeometrySchema>;

export function defaultDevelopGeometry(): DevelopGeometry {
  return {
    upright: "off",
    vertical: 0,
    horizontal: 0,
    rotate: 0,
    aspect: 0,
    scale: 100,
    xOffset: 0,
    yOffset: 0,
    constrainCrop: false,
    guides: [],
    solved: null,
  };
}

const sameGuides = (a: readonly UprightGuide[], b: readonly UprightGuide[]) =>
  a.length === b.length &&
  a.every(
    (g, i) => g.x1 === b[i]!.x1 && g.y1 === b[i]!.y1 && g.x2 === b[i]!.x2 && g.y2 === b[i]!.y2,
  );

/** The solution that applies to the current mode and guides, or null when a solve is due. */
export function currentUprightSolution(geometry: DevelopGeometry): UprightSolution | null {
  const solved = geometry.solved;
  if (geometry.upright === "off" || !solved || solved.mode !== geometry.upright) return null;
  if (geometry.upright === "guided" && !sameGuides(solved.guides, geometry.guides)) return null;
  return solved;
}

/** True when Upright is on but has no current measurement for this photo. */
export function uprightNeedsSolve(geometry: DevelopGeometry): boolean {
  if (geometry.upright === "off") return false;
  if (geometry.upright === "guided" && geometry.guides.length === 0) return false;
  return currentUprightSolution(geometry) === null;
}

/** The 13 engine values (UPRIGHT_1), or null when no pixel would move. Constrain
 * Crop alone changes nothing: an unwarped frame is already its own inscribed crop.
 */
export function uprightTransformValues(geometry: DevelopGeometry | undefined): number[] | null {
  if (!geometry) return null;
  const solved = currentUprightSolution(geometry);
  const values = [
    solved?.roll ?? 0,
    solved?.pitch ?? 0,
    solved?.yaw ?? 0,
    solved?.focal ?? 0,
    0, // k1: no recipe field carries a lens distortion profile yet
    geometry.vertical,
    geometry.horizontal,
    geometry.rotate,
    geometry.aspect,
    geometry.scale,
    geometry.xOffset,
    geometry.yOffset,
    geometry.constrainCrop ? 1 : 0,
  ].map((value) => value + 0); // fold -0
  const moves =
    values[0] !== 0 ||
    values[1] !== 0 ||
    values[2] !== 0 ||
    values.slice(5, 9).some((value) => value !== 0) ||
    values[9] !== 100 ||
    values[10] !== 0 ||
    values[11] !== 0;
  return moves ? values : null;
}

export function geometryIsNeutral(geometry: DevelopGeometry | undefined): boolean {
  return uprightTransformValues(geometry) === null;
}

/** Line appended to the text recipe for the local executable. Empty when neutral. */
export function uprightProtocolLine(geometry: DevelopGeometry | undefined): string {
  const values = uprightTransformValues(geometry);
  return values ? `UPRIGHT_1 ${values.join(" ")}\n` : "";
}

export type UprightSolveRequest = {
  mode: Exclude<UprightMode, "off">;
  guides: UprightGuide[];
  /** Long edge the engine measures (256..2048). */
  analysisEdge?: number;
};

/** Doubles for celinen_upright_solve. */
export function uprightSolveValues(request: UprightSolveRequest): Float64Array {
  const guides = request.guides.slice(0, UPRIGHT_MAX_GUIDES);
  const edge = Math.min(2048, Math.max(256, Math.round(request.analysisEdge ?? 1024)));
  const values = new Float64Array(5 + guides.length * 4);
  values.set([MODE_CODE[request.mode], edge, 0, 0, guides.length]);
  guides.forEach((g, i) => values.set([g.x1, g.y1, g.x2, g.y2], 5 + i * 4));
  return values;
}

const FOCAL_SOURCES = ["default", "exif", "sensor", "measured", "guided"] as const;
/** Reads the engine's 12 result doubles into a stored solution. */
export function uprightSolutionFromValues(
  values: ArrayLike<number>,
  request: UprightSolveRequest,
): UprightSolution {
  const mode = UPRIGHT_MODES[values[1]!] ?? "off";
  const clampAngle = (value: number) =>
    Math.min(45, Math.max(-45, Math.round(value * 1000) / 1000 + 0));
  return uprightSolutionSchema.parse({
    mode: request.mode,
    applied: mode,
    fallback: values[2] === 1,
    roll: clampAngle(values[3]!),
    pitch: clampAngle(values[4]!),
    yaw: clampAngle(values[5]!),
    focal: Math.min(10, Math.max(0.2, values[6]!)),
    focalSource: FOCAL_SOURCES[values[7]!] ?? "default",
    confidence: Math.min(1, Math.max(0, Math.round(values[8]! * 1000) / 1000)),
    guides: request.mode === "guided" ? request.guides.map((g) => ({ ...g })) : [],
  });
}

/** The first bytes of a photo hold its EXIF (JPEG APP1 or a TIFF-based RAW's IFDs). */
export const UPRIGHT_EXIF_BYTES = 256 * 1024;
