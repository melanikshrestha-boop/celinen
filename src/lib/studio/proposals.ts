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
  /** Transient approval basis, including unchanged candidates; never persisted or sent to AI. */
  scopeBasis: { id: string; file: File; state: string }[];
  frames: ProposalFrame[];
};

const readable = (shot: Shot) => shot.error === undefined;
const stalePreview = () =>
  new Error(
    "The shoot changed after this preview. Make a fresh preview so your latest sources, edits and decisions stay safe.",
  );

/** Values used by review/ranking/editing, not disposable preview URLs or view selection. */
function reviewState(shot: Shot) {
  return JSON.stringify([
    shot.name,
    shot.relativePath,
    shot.sourceAvailable !== false,
    shot.isRaw,
    shot.width,
    shot.height,
    shot.verdict,
    shot.edits.exposure,
    shot.edits.contrast,
    shot.edits.temp,
    shot.edits.saturation,
    shot.edits.highlights,
    shot.edits.shadows,
    shot.edits.crop,
    String(shot.score),
    String(shot.sharpness),
    String(shot.brightness),
    String(shot.clippedHighlights),
    String(shot.clippedShadows),
    shot.flags,
    shot.hash,
    shot.captureTimeMs,
    shot.captureTimeBasis,
    shot.cameraKey,
    shot.analysisBackend,
    shot.faces,
    shot.tone,
    shot.develop,
  ]);
}

function approvalBasis(shots: readonly Shot[]) {
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length)
    throw new Error("Repeated source identifiers. Reconnect this shoot before making a preview.");
  return shots.map((shot) => ({ id: shot.id, file: shot.file, state: reviewState(shot) }));
}

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
  const scoped = shots.filter(
    (shot) =>
      readable(shot) &&
      (target === "all" ||
        (target === "keepers" ? shot.verdict === "keep" : shot.id === selectedId)),
  );
  const scopeBasis = approvalBasis(scoped);
  const frames = scoped.map((shot) => ({
    id: shot.id,
    name: shot.name,
    beforeEdits: { ...shot.edits },
    afterEdits: { ...transform(shot) },
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
    scopeBasis,
    frames,
  };
}

export function proposeCull(
  shots: readonly Shot[],
  decide: (shot: Shot) => Verdict,
  details: { title: string; description: string },
): StudioProposal {
  const candidates = shots.filter(readable);
  const scopeBasis = approvalBasis(candidates);
  const frames = candidates
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
    scopeIds: candidates.map((shot) => shot.id),
    scopeBasis,
    frames,
  };
}

/** All-or-nothing: a newer manual decision invalidates the proposal, never gets overwritten. */
export function applyProposal(shots: readonly Shot[], proposal: StudioProposal): Shot[] {
  const current = new Map(shots.map((shot) => [shot.id, shot]));
  if (
    current.size !== shots.length ||
    !Array.isArray(proposal.scopeBasis) ||
    !Array.isArray(proposal.scopeIds)
  )
    throw stalePreview();
  const basisIds = new Set(proposal.scopeBasis.map((basis) => basis.id));
  if (
    basisIds.size !== proposal.scopeBasis.length ||
    basisIds.size !== proposal.scopeIds.length ||
    new Set(proposal.scopeIds).size !== basisIds.size ||
    proposal.scopeIds.some((id) => !basisIds.has(id)) ||
    new Set(proposal.frames.map((frame) => frame.id)).size !== proposal.frames.length ||
    proposal.frames.some((frame) => !basisIds.has(frame.id))
  )
    throw stalePreview();
  // Culls depend on the whole compared set, even frames whose verdict stays the same.
  // File objects are immutable: any reconnect/replacement conservatively needs a new preview.
  for (const basis of proposal.scopeBasis) {
    const shot = current.get(basis.id);
    if (!shot || !readable(shot) || shot.file !== basis.file || reviewState(shot) !== basis.state)
      throw stalePreview();
  }
  if (proposal.target !== "selected") {
    const currentScope = shots.filter(
      (shot) => readable(shot) && (proposal.target === "all" || shot.verdict === "keep"),
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
  for (const frame of proposal.frames) {
    const shot = current.get(frame.id);
    if (
      !shot ||
      !readable(shot) ||
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
