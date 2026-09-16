/** Taste engine: visual scores × Lenslab profile × photographer profile. */

export type AestheticProfile = {
  emotional_storytelling: number;
  technical_perfection: number;
  natural_skin: number;
  dramatic_contrast: number;
  film_character: number;
  clean_backgrounds: number;
  symmetry: number;
  negative_space: number;
  motion_energy: number;
  minimal_editing: number;
};

export type SportsTaste = {
  peak_action: number;
  ball_visibility: number;
  face_visibility: number;
  emotion: number;
  sharpness: number;
  story_context: number;
};

export type PortraitTaste = {
  expression: number;
  eye_focus: number;
  skin_texture: number;
  background_separation: number;
};

export type TasteProfile = {
  aesthetic_profile: AestheticProfile;
  sports: SportsTaste;
  portrait: PortraitTaste;
};

export type VisualScores = {
  peak_action?: number;
  expression?: number;
  subject_focus?: number;
  composition?: number;
  storytelling?: number;
  background_quality?: number;
  ball_visibility?: number;
  face_visibility?: number;
  sharpness?: number;
  skin_texture?: number;
  motion_energy?: number;
};

export const LENSLAB_TASTE: TasteProfile = {
  aesthetic_profile: {
    emotional_storytelling: 0.94,
    technical_perfection: 0.78,
    natural_skin: 0.96,
    dramatic_contrast: 0.65,
    film_character: 0.72,
    clean_backgrounds: 0.84,
    symmetry: 0.51,
    negative_space: 0.7,
    motion_energy: 0.91,
    minimal_editing: 0.74,
  },
  sports: {
    peak_action: 0.98,
    ball_visibility: 0.83,
    face_visibility: 0.88,
    emotion: 0.94,
    sharpness: 0.91,
    story_context: 0.82,
  },
  portrait: {
    expression: 0.96,
    eye_focus: 0.94,
    skin_texture: 0.91,
    background_separation: 0.84,
  },
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function blend(house: number, user?: number) {
  if (user === undefined) return house;
  return clamp01(house * 0.45 + user * 0.55);
}

export function scoreFrame(
  visual: VisualScores,
  genre: "sports" | "portrait" | "general" = "sports",
  user?: Partial<SportsTaste & PortraitTaste & AestheticProfile>,
): number {
  const house = LENSLAB_TASTE;
  const weights =
    genre === "portrait"
      ? {
          expression: blend(house.portrait.expression, user?.expression),
          subject_focus: blend(house.portrait.eye_focus, user?.eye_focus),
          skin_texture: blend(house.portrait.skin_texture, user?.skin_texture),
          background_quality: blend(house.portrait.background_separation, user?.background_separation),
          storytelling: blend(house.aesthetic_profile.emotional_storytelling, user?.emotional_storytelling),
        }
      : {
          peak_action: blend(house.sports.peak_action, user?.peak_action),
          expression: blend(house.sports.emotion, user?.emotion),
          subject_focus: blend(house.sports.sharpness, user?.sharpness),
          ball_visibility: blend(house.sports.ball_visibility, user?.ball_visibility),
          face_visibility: blend(house.sports.face_visibility, user?.face_visibility),
          storytelling: blend(house.sports.story_context, user?.story_context),
          motion_energy: blend(house.aesthetic_profile.motion_energy, user?.motion_energy),
          background_quality: blend(house.aesthetic_profile.clean_backgrounds),
        };
  let total = 0;
  let mass = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const observed = visual[key as keyof VisualScores];
    if (typeof observed !== "number") continue;
    total += clamp01(observed) * weight;
    mass += weight;
  }
  return mass ? total / mass : 0;
}

export function pickFrame<T extends { id: string; visual: VisualScores }>(
  frames: readonly T[],
  genre: "sports" | "portrait" | "general" = "sports",
  user?: Partial<SportsTaste & PortraitTaste & AestheticProfile>,
): { winner: T; score: number; runnerUp?: T; runnerScore?: number } | null {
  if (!frames.length) return null;
  const ranked = frames
    .map((frame) => ({ frame, score: scoreFrame(frame.visual, genre, user) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  const next = ranked[1];
  return {
    winner: best.frame,
    score: best.score,
    ...(next ? { runnerUp: next.frame, runnerScore: next.score } : {}),
  };
}

export function explainPick(
  winnerId: string,
  winner: VisualScores,
  otherId: string,
  other: VisualScores,
): string {
  const reasons: string[] = [];
  if ((winner.peak_action ?? 0) > (other.peak_action ?? 0) + 0.04)
    reasons.push("peak action is still happening");
  if ((winner.face_visibility ?? winner.expression ?? 0) > (other.face_visibility ?? other.expression ?? 0) + 0.04)
    reasons.push("the face is in the moment");
  if ((winner.ball_visibility ?? 0) > (other.ball_visibility ?? 0) + 0.04)
    reasons.push("the ball is still in frame");
  if ((winner.storytelling ?? 0) > (other.storytelling ?? 0) + 0.04)
    reasons.push("the tension with the defender is intact");
  if ((other.sharpness ?? other.subject_focus ?? 0) > (winner.sharpness ?? winner.subject_focus ?? 0) + 0.04)
    reasons.push(`the other frame is technically cleaner`);
  const why = reasons.length ? reasons.join(", ") : "it has more of a reason to exist";
  return `I'd pick ${winnerId}. ${otherId} may be cleaner, but ${winnerId} wins because ${why}.`;
}
