import type { Shot } from "@/lib/imaging";

export type ShootBrief = {
  title: string;
  total: number;
  keepers: number;
  undecided: number;
  missingOriginals: number;
  reviewId: string | null;
  previews: Pick<Shot, "id" | "name" | "previewUrl" | "verdict">[];
};

/** A bounded view of the real shoot, never a second image cache or a synthetic progress score. */
export function describeShoot(shots: readonly Shot[], selectedId: string | null): ShootBrief {
  const brief: ShootBrief = {
    title: "Your shoot",
    total: shots.length,
    keepers: 0,
    undecided: 0,
    missingOriginals: 0,
    reviewId: null,
    previews: [],
  };
  const folder = shots[0]?.relativePath?.split("/").slice(0, -1)[0];
  if (folder && shots.every((shot) => shot.relativePath?.startsWith(`${folder}/`)))
    brief.title = folder;
  const selected = shots.find((shot) => shot.id === selectedId && shot.previewUrl);
  if (selected) brief.previews.push(selected);
  for (const shot of shots) {
    if (shot.verdict === "keep") brief.keepers++;
    if (shot.verdict === "undecided") {
      brief.undecided++;
      brief.reviewId ??= shot.id;
    }
    if (shot.sourceAvailable === false) brief.missingOriginals++;
    if (shot.previewUrl && brief.previews.length < 6 && shot.id !== selected?.id)
      brief.previews.push(shot);
  }
  brief.reviewId ??= selectedId ?? shots[0]?.id ?? null;
  // Don't expose File/Blob objects to the presentational view.
  brief.previews = brief.previews.map(({ id, name, previewUrl, verdict }) => ({
    id,
    name,
    previewUrl,
    verdict,
  }));
  return brief;
}
