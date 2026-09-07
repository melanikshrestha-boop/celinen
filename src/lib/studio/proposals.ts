import { type Edits, type Shot, type Verdict } from "../imaging";

export type EditTarget = "selected" | "keepers" | "all";
export type ProposalFrame = {
  id: string;
  name: string;
  beforeEdits: Edits;
  afterEdits: Edits;
  beforeVerdict: Verdict;
  afterVerdict: Verdict;
};
export type StudioProposal = {
  kind: "edit" | "cull";
  title: string;
  description: string;
  target: EditTarget;
  limitations: string[];
  /** Full readable scope at preview time, including unchanged culling frames. */
  scopeIds: string[];
  frames: ProposalFrame[];
};

export function sameEdits(a: Edits, b: Edits): boolean {
  return (
    a.exposure === b.exposure &&
    a.contrast === b.contrast &&
    a.temp === b.temp &&
    a.saturation === b.saturation &&
    a.highlights === b.highlights &&
    a.shadows === b.shadows &&
    a.crop === b.crop
  );
}

export function proposeEdits(
  shots: readonly Shot[],
  selectedId: string | null,
  target: EditTarget,
  transform: (shot: Shot) => Edits,
  details: { title: string; description: string; limitations?: string[] },
): StudioProposal {
  const frames = shots
    .filter(
      (shot) =>
        !shot.error &&
        (target === "all" ||
          (target === "keepers" ? shot.verdict === "keep" : shot.id === selectedId)),
    )
    .map((shot) => ({
      id: shot.id,
      name: shot.name,
      beforeEdits: { ...shot.edits },
      afterEdits: transform(shot),
      beforeVerdict: shot.verdict,
      afterVerdict: shot.verdict,
    }));
  if (!frames.length)
    throw new Error(
      target === "keepers"
        ? "Pick some keepers first, then describe their look."
        : "Open a readable photo first, then describe the edit.",
    );
  return {
    kind: "edit",
    title: details.title,
    description: details.description,
    target,
    limitations: details.limitations ?? [],
    scopeIds: frames.map((frame) => frame.id),
    frames,
  };
}

export function proposeCull(
  shots: readonly Shot[],
  decide: (shot: Shot) => Verdict,
  details: { title: string; description: string },
): StudioProposal {
  const readable = shots.filter((shot) => !shot.error);
  const frames = readable
    .map((shot) => ({
      id: shot.id,
      name: shot.name,
      beforeEdits: { ...shot.edits },
      afterEdits: { ...shot.edits },
      beforeVerdict: shot.verdict,
      afterVerdict: decide(shot),
    }))
    .filter((frame) => frame.beforeVerdict !== frame.afterVerdict);
  if (!frames.length)
    throw new Error("No new selection changes to suggest. Your existing picks are unchanged.");
  return {
    kind: "cull",
    target: "all",
    ...details,
    limitations: [
      "Focus, exposure and similarity are clues—not a judgment of the moment. Originals stay untouched.",
    ],
    scopeIds: readable.map((shot) => shot.id),
    frames,
  };
}

/** All-or-nothing: a newer manual decision invalidates the proposal, never gets overwritten. */
export function applyProposal(shots: readonly Shot[], proposal: StudioProposal): Shot[] {
  if (proposal.target !== "selected") {
    const currentScope = shots.filter(
      (shot) => !shot.error && (proposal.target === "all" || shot.verdict === "keep"),
    );
    const scopeIds = new Set(proposal.scopeIds);
    const currentIds = new Set(currentScope.map((shot) => shot.id));
    if (
      !Array.isArray(proposal.scopeIds) ||
      scopeIds.size !== proposal.scopeIds.length ||
      currentScope.length !== scopeIds.size ||
      currentIds.size !== scopeIds.size ||
      currentScope.some((shot) => !scopeIds.has(shot.id))
    ) {
      throw new Error(
        "The shoot changed after this preview. Make a fresh preview so the full batch and your latest decisions stay safe.",
      );
    }
  }
  const current = new Map(shots.map((shot) => [shot.id, shot]));
  for (const frame of proposal.frames) {
    const shot = current.get(frame.id);
    if (
      !shot ||
      shot.error ||
      !sameEdits(shot.edits, frame.beforeEdits) ||
      shot.verdict !== frame.beforeVerdict
    ) {
      throw new Error(
        "The shoot changed after this preview. Make a fresh preview so your latest decisions stay safe.",
      );
    }
  }
  const changes = new Map(proposal.frames.map((frame) => [frame.id, frame]));
  return shots.map((shot) => {
    const frame = changes.get(shot.id);
    return frame ? { ...shot, edits: { ...frame.afterEdits }, verdict: frame.afterVerdict } : shot;
  });
}
