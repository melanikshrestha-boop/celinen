import type { Flag, Shot } from "@/lib/imaging";

export type ReviewIssue = "focus" | "exposure" | "duplicates";

export const REVIEW_ISSUE_FLAGS: Record<ReviewIssue, readonly Flag[]> = {
  focus: ["blur", "soft", "face-soft", "eyes-closed"],
  exposure: ["underexposed", "overexposed"],
  duplicates: ["duplicate"],
};

export function hasReviewIssue(shot: Shot, issue: ReviewIssue): boolean {
  const flags = REVIEW_ISSUE_FLAGS[issue];
  return shot.flags.some((flag) => flags.includes(flag));
}

export function filterReviewIssue(shots: readonly Shot[], issue: ReviewIssue | null): Shot[] {
  return issue ? shots.filter((shot) => hasReviewIssue(shot, issue)) : [...shots];
}

export function countReviewIssue(shots: readonly Shot[], issue: ReviewIssue): number {
  return shots.reduce((count, shot) => count + Number(hasReviewIssue(shot, issue)), 0);
}
