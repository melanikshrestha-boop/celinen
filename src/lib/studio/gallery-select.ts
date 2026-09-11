/**
 * Gallery-as-a-whole selection.
 *
 * Photograph scoring answers "which frames look good."
 * This module answers "which frames belong in this job's gallery."
 *
 * Evidence stays separate: technical quality, people coverage, moment uniqueness.
 * A technical issue is evidence; it does not automatically overrule a unique moment.
 * Recommendations never delete originals. Alternatives stay reviewable.
 */
import type { Shot, Verdict } from "@/lib/imaging";
import type { BurstGroup } from "./bursts";
import type { EventPerson } from "./people";

export type GalleryRole = "recommended" | "alternative" | "needs-judgment";

export type MomentRelation =
  | "same-capture"
  | "interchangeable"
  | "different-expression"
  | "different-viewpoint"
  | "different-moment";

export type Moment = {
  id: string;
  chapter: string;
  frameIds: string[];
  relation: MomentRelation;
  spanMs: number;
};

export type ImageEvidence = {
  frameId: string;
  technical: {
    usable: boolean;
    sharpness: number;
    blur: boolean;
    exposureIssue: boolean;
    faceCount: number;
    eyesClosed: boolean | null;
  };
  people: {
    confirmedIds: string[];
    clusterIds: string[];
  };
  uniqueMoment: boolean;
};

export type CoverageGap = {
  personId: string;
  label: string;
  selectedCount: number;
  candidateIds: string[];
};

export type GalleryPlan = {
  recommendedIds: string[];
  alternativeIds: string[];
  needsJudgmentIds: string[];
  moments: Moment[];
  evidence: ImageEvidence[];
  coverage: CoverageGap[];
  limitations: string[];
};

export type GalleryCorrectionReason =
  | "expression"
  | "gesture"
  | "focus"
  | "composition"
  | "important-person"
  | "less-repetitive"
  | "personal-preference"
  | "both-acceptable"
  | "this-wedding-only";

export type GalleryCorrection = {
  at: number;
  preferredId: string;
  replacedId: string;
  reason: GalleryCorrectionReason;
  note?: string;
};

const MOMENT_GAP_MS = 8000;
const TARGET_RATE = 0.2;
const MIN_KEEP = 12;

function folderOf(shot: Shot): string {
  const path = (shot.relativePath ?? shot.name).replace(/\\/g, "/");
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function chapterOf(shot: Shot): string {
  const folder = folderOf(shot).toLowerCase();
  if (/(prep|getting.?ready|first.?look)/.test(folder)) return "preparation";
  if (/(ceremon|aisle|vows)/.test(folder)) return "ceremony";
  if (/(portrait|formals|family)/.test(folder)) return "portraits";
  if (/(recept|dance|toast|speech|party)/.test(folder)) return "reception";
  if (/(game|match|inning|half|sideline)/.test(folder)) return "action";
  return folder || "job";
}

export function groupMoments(shots: readonly Shot[], bursts: readonly BurstGroup[] = []): Moment[] {
  const assigned = new Set<string>();
  const moments: Moment[] = [];
  for (const burst of bursts) {
    const members = burst.frameIds.filter((id) => shots.some((shot) => shot.id === id));
    if (members.length < 2) continue;
    members.forEach((id) => assigned.add(id));
    moments.push({
      id: burst.id,
      chapter: chapterOf(shots.find((shot) => shot.id === members[0])!),
      frameIds: members,
      relation: burst.kind === "burst" ? "different-expression" : "interchangeable",
      spanMs: burst.evidence.spanMs,
    });
  }
  const rest = shots
    .filter((shot) => !assigned.has(shot.id) && !shot.error)
    .slice()
    .sort((a, b) => (a.captureTimeMs ?? 0) - (b.captureTimeMs ?? 0) || a.id.localeCompare(b.id));
  let current: Shot[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    moments.push({
      id: `moment:${first.id}`,
      chapter: chapterOf(first),
      frameIds: current.map((shot) => shot.id),
      relation: current.length === 1 ? "different-moment" : "different-expression",
      spanMs:
        current.length > 1
          ? (current[current.length - 1]!.captureTimeMs ?? 0) - (first.captureTimeMs ?? 0)
          : 0,
    });
    current = [];
  };
  for (const shot of rest) {
    const last = current[current.length - 1];
    const timed =
      last &&
      (shot.captureTimeMs ?? 0) > 0 &&
      (last.captureTimeMs ?? 0) > 0 &&
      shot.cameraKey &&
      shot.cameraKey === last.cameraKey &&
      folderOf(shot) === folderOf(last) &&
      (shot.captureTimeMs ?? 0) - (last.captureTimeMs ?? 0) <= MOMENT_GAP_MS;
    if (!timed) flush();
    current.push(shot);
  }
  flush();
  return moments;
}

export function evidenceFor(
  shot: Shot,
  moment: Moment,
  people: readonly EventPerson[],
): ImageEvidence {
  const clusterIds = people.filter((person) => person.frameIds.includes(shot.id)).map((person) => person.id);
  const confirmedIds = people
    .filter((person) => person.confirmed && person.frameIds.includes(shot.id))
    .map((person) => person.id);
  const blur = shot.flags.includes("blur") || shot.flags.includes("soft");
  const exposureIssue = shot.flags.includes("underexposed") || shot.flags.includes("overexposed");
  const uniqueMoment = moment.frameIds.length === 1;
  const usable = !shot.error && (!blur || uniqueMoment) && (!exposureIssue || uniqueMoment);
  return {
    frameId: shot.id,
    technical: {
      usable,
      sharpness: shot.sharpness,
      blur,
      exposureIssue,
      faceCount: shot.faces?.count ?? 0,
      eyesClosed: shot.faces?.eyesOpen === false ? true : shot.faces?.eyesOpen === true ? false : null,
    },
    people: { confirmedIds, clusterIds },
    uniqueMoment,
  };
}

function withinMomentScore(shot: Shot, evidence: ImageEvidence): number {
  const quality = Math.max(0, Math.min(1, shot.score / 100));
  const sharpness = Math.max(0, Math.min(1, Math.log10(1 + evidence.technical.sharpness) / 2.9));
  let score = 0.55 * quality + 0.25 * sharpness;
  if (evidence.technical.usable) score += 0.08;
  if (evidence.people.confirmedIds.length) score += 0.08 * Math.min(2, evidence.people.confirmedIds.length);
  const groupPortrait = evidence.technical.faceCount >= 3;
  if (groupPortrait && evidence.technical.eyesClosed) score -= 0.12;
  if (!groupPortrait && evidence.technical.eyesClosed) score -= 0.02;
  if (shot.verdict === "keep") score += 0.2;
  if (shot.verdict === "reject") score -= 0.5;
  return score;
}

export function proposeGallery(
  shots: readonly Shot[],
  options: {
    bursts?: readonly BurstGroup[];
    people?: readonly EventPerson[];
    targetCount?: number;
  } = {},
): GalleryPlan {
  const readable = shots.filter((shot) => !shot.error);
  const moments = groupMoments(readable, options.bursts ?? []);
  const byId = new Map(readable.map((shot) => [shot.id, shot]));
  const people = options.people ?? [];
  const evidence = moments.flatMap((moment) =>
    moment.frameIds
      .map((id) => byId.get(id))
      .filter((shot): shot is Shot => Boolean(shot))
      .map((shot) => evidenceFor(shot, moment, people)),
  );
  const evidenceById = new Map(evidence.map((row) => [row.frameId, row]));
  const recommended = new Set<string>();
  const alternatives = new Set<string>();
  const judgment = new Set<string>();

  const target =
    options.targetCount ??
    Math.max(MIN_KEEP, Math.min(readable.length, Math.round(readable.length * TARGET_RATE)));

  for (const moment of moments) {
    const ranked = moment.frameIds
      .map((id) => byId.get(id))
      .filter((shot): shot is Shot => Boolean(shot) && shot.verdict !== "reject")
      .map((shot) => ({
        shot,
        evidence: evidenceById.get(shot.id)!,
        score: withinMomentScore(shot, evidenceById.get(shot.id)!),
      }))
      .sort((a, b) => b.score - a.score || a.shot.id.localeCompare(b.shot.id));
    if (!ranked.length) continue;
    const first = ranked[0]!;
    const unique = moment.frameIds.length === 1 || first.evidence.uniqueMoment;
    if (first.shot.verdict === "keep" || first.evidence.technical.usable || unique) {
      recommended.add(first.shot.id);
    } else {
      judgment.add(first.shot.id);
    }
    const second = ranked[1];
    if (second && ranked.length >= 6 && second.score > first.score * 0.92) {
      const newPerson = second.evidence.people.confirmedIds.some(
        (id) => !first.evidence.people.confirmedIds.includes(id),
      );
      if (newPerson || second.score > 0.75) recommended.add(second.shot.id);
      else alternatives.add(second.shot.id);
    }
    for (const row of ranked.slice(recommended.has(first.shot.id) ? 1 : 0)) {
      if (recommended.has(row.shot.id) || alternatives.has(row.shot.id) || judgment.has(row.shot.id)) {
        continue;
      }
      alternatives.add(row.shot.id);
    }
  }

  const coverage: CoverageGap[] = [];
  for (const person of people.filter((row) => row.confirmed || row.role === "priority" || row.role === "couple")) {
    const selectedCount = person.frameIds.filter((id) => recommended.has(id)).length;
    if (selectedCount >= 2) continue;
    const candidates = person.frameIds.filter((id) => {
      const shot = byId.get(id);
      return shot && shot.verdict !== "reject" && !recommended.has(id);
    });
    if (!candidates.length && selectedCount === 0) {
      coverage.push({
        personId: person.id,
        label: person.label || person.id,
        selectedCount,
        candidateIds: [],
      });
      continue;
    }
    const extra = candidates
      .map((id) => byId.get(id)!)
      .sort((a, b) => b.score - a.score)[0];
    if (extra && selectedCount < 2) {
      judgment.add(extra.id);
      alternatives.delete(extra.id);
    }
    coverage.push({
      personId: person.id,
      label: person.label || person.id,
      selectedCount,
      candidateIds: candidates.slice(0, 8),
    });
  }

  if (recommended.size > target) {
    const extras = [...recommended]
      .map((id) => byId.get(id)!)
      .filter((shot) => shot.verdict !== "keep")
      .sort((a, b) => a.score - b.score);
    for (const shot of extras) {
      if (recommended.size <= target) break;
      const ev = evidenceById.get(shot.id);
      if (ev?.uniqueMoment) continue;
      recommended.delete(shot.id);
      alternatives.add(shot.id);
    }
  }

  for (const shot of readable) {
    if (shot.verdict === "keep") recommended.add(shot.id);
  }

  const limitations = [
    "Recommended frames become Keep. Alternatives and frames that need judgment stay undecided. Nothing is deleted.",
    "A technically excellent duplicate can lose to a slightly soft unique moment.",
    "People clusters are event-local. Unlabeled Person 12 is not a name.",
  ];
  if (coverage.length) {
    limitations.push(
      coverage
        .map((gap) =>
          gap.candidateIds.length
            ? `Few selected photographs of ${gap.label}. Review ${gap.candidateIds.length} candidate${gap.candidateIds.length === 1 ? "" : "s"}.`
            : `Few selected photographs of ${gap.label}. Matching may have missed this person — do not treat that as proof they were never photographed.`,
        )
        .join(" "),
    );
  }

  return {
    recommendedIds: [...recommended],
    alternativeIds: [...alternatives].filter((id) => !recommended.has(id) && !judgment.has(id)),
    needsJudgmentIds: [...judgment].filter((id) => !recommended.has(id)),
    moments,
    evidence,
    coverage,
    limitations,
  };
}

export function decideGallery(shot: Shot, plan: GalleryPlan): Verdict {
  if (shot.verdict !== "undecided") return shot.verdict;
  if (plan.recommendedIds.includes(shot.id)) return "keep";
  return "undecided";
}

export function recordCorrection(
  corrections: readonly GalleryCorrection[],
  entry: Omit<GalleryCorrection, "at"> & { at?: number },
): GalleryCorrection[] {
  if (entry.preferredId === entry.replacedId) return [...corrections];
  return [
    ...corrections,
    {
      at: entry.at ?? Date.now(),
      preferredId: entry.preferredId,
      replacedId: entry.replacedId,
      reason: entry.reason,
      ...(entry.note ? { note: entry.note } : {}),
    },
  ];
}

export function pairwiseLoss(preferredScore: number, alternativeScore: number): number {
  return Math.log(1 + Math.exp(-(preferredScore - alternativeScore)));
}
