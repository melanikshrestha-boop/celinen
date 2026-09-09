import type { Shot } from "../imaging";
import { createLightroomVerdicts, mergeLightroomFrames } from "../lightroom-matching";
import { applyProposal, sameEdits, type StudioProposal } from "../studio/proposals";
import type { HydratedStudioSession, StudioFilter } from "../studio/session";
import {
  developPhotoFromShot,
  type DevelopDocument,
  type DevelopLibrary,
  type ShootManifest,
} from "./store";
import { projectDevelopPhotoToStudio, type ShootRepository } from "./shoot-repository";

type Review = DevelopDocument["metadata"];
type Snapshot = DevelopLibrary & { manifest: ShootManifest };
export type DevelopViewBaseline = {
  selectedId: string | null;
  filter: string;
  sourceSelectedId: string | null;
  sourceFilter: string;
};
export function developViewFilter(filter: string): string {
  return filter === "keepers"
    ? "picks"
    : ["picks", "rated", "not-rejected"].includes(filter)
      ? filter
      : "all";
}
/** Preserve unsupported filters and newer other-tab views unless this view changed them. */
export function reconcileDevelopView(
  manifest: ShootManifest,
  baseline: DevelopViewBaseline,
  selectedId: string | null,
  filter: string,
  explicitFilter = false,
) {
  const changedSelection = selectedId !== baseline.selectedId;
  const changedFilter = explicitFilter || filter !== baseline.filter;
  const wantedFilter = filter === "picks" ? "keepers" : filter;
  if (
    changedSelection &&
    manifest.selectedId !== baseline.sourceSelectedId &&
    manifest.selectedId !== selectedId
  )
    throw new Error(
      "This shoot's selection changed in another view. Reopen it before changing the selection.",
    );
  if (
    changedFilter &&
    manifest.filter !== baseline.sourceFilter &&
    manifest.filter !== wantedFilter
  )
    throw new Error(
      "This shoot's filter changed in another view. Reopen it before changing the filter.",
    );
  return {
    view: {
      photoIds: manifest.photoIds,
      selectedId: changedSelection ? selectedId : manifest.selectedId,
      filter: changedFilter ? wantedFilter : manifest.filter,
    },
    baseline: {
      ...baseline,
      ...(changedSelection ? { selectedId, sourceSelectedId: selectedId } : {}),
      ...(changedFilter ? { filter, sourceFilter: wantedFilter } : {}),
    },
  };
}
export class CullRefreshSuperseded extends Error {
  constructor() {
    super(
      "Cull changed while its saved view was loading. Keep the current gesture and refresh again.",
    );
    this.name = "CullRefreshSuperseded";
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const filters = new Set<StudioFilter>(["all", "keepers", "flagged", "rejected", "todo"]);
function reviewFromShot(shot: Shot, original: Review): Review {
  return {
    ...original,
    flag: shot.verdict === "keep" ? "pick" : shot.verdict === "reject" ? "reject" : null,
    // An absent legacy field is not an instruction to erase a canonical value.
    ...(shot.develop?.rating !== undefined ? { rating: shot.develop.rating } : {}),
    ...(shot.develop?.label !== undefined
      ? {
          colorLabel:
            shot.develop.label === null
              ? null
              : (shot.develop.label.toLowerCase() as Review["colorLabel"]),
        }
      : {}),
  };
}

/** Old review history may contain slider values; those are not native edit authority. */
export function restoreCullReview(
  shots: readonly Shot[],
  frames: readonly Pick<Shot, "id" | "verdict">[],
): Shot[] {
  const prior = new Map(frames.map((frame) => [frame.id, frame.verdict]));
  return shots.map((shot) =>
    prior.has(shot.id) ? { ...shot, verdict: prior.get(shot.id)! } : shot,
  );
}

export function applyCullReviewProposal(shots: readonly Shot[], proposal: StudioProposal): Shot[] {
  if (
    proposal.kind !== "cull" ||
    proposal.frames.some((frame) => !sameEdits(frame.beforeEdits, frame.afterEdits))
  )
    throw new Error("Image adjustments must be reviewed in Develop. No settings were applied.");
  return applyProposal(shots, proposal);
}

/** Match paths with the existing strict bridge, but import supported review fields only. */
export function mergeCullLightroomReviews(shots: readonly Shot[], input: unknown, now: number) {
  const result = mergeLightroomFrames(shots, input, now);
  return {
    ...result,
    shots: result.shots.map((incoming, index) => {
      const original = shots[index]!;
      if (incoming === original) return original;
      const rating = incoming.develop?.rating;
      const label = incoming.develop?.label;
      if (
        label !== undefined &&
        label !== null &&
        !["red", "yellow", "green", "blue", "purple"].includes(label.toLowerCase())
      )
        throw new Error("This Lightroom color label is not supported. No reviews were changed.");
      return {
        ...original,
        verdict: incoming.verdict,
        develop: {
          origin: "lens os" as const,
          at: now,
          ...original.develop,
          ...(rating !== undefined && rating >= 0 ? { rating } : {}),
          ...(label !== undefined ? { label } : {}),
        },
      };
    }),
  };
}

/** A verdict handoff cannot export archived sliders as if they were native treatment. */
export function createCullLightroomVerdicts(shots: readonly Shot[]) {
  return createLightroomVerdicts(shots).map(
    ({ develop: _develop, score: _score, ...review }) => review,
  );
}

/** Cull is a review projection, never a second image-treatment writer. */
export function createCullShootView(repository: ShootRepository) {
  let loaded: Snapshot | null = null;
  // The view baseline advances only when Cull actually adopts a view or saves a
  // changed gesture. A hidden no-op flush must not turn a newer Develop selection
  // into a subsequent stale "clear selection" gesture.
  let adoptedView: Pick<ShootManifest, "selectedId" | "filter"> | null = null;
  const baseline = new Map<string, { photoId: string; review: Review; edits: Shot["edits"] }>();
  const reusableFiles = new Map<string, { blob: Blob | null; file: File }>();
  let queue: Promise<unknown> = Promise.resolve();
  const view = {
    photoId(shotId: string): string | null {
      return baseline.get(shotId)?.photoId ?? null;
    },
    async read(
      legacy?: HydratedStudioSession | null,
      mayAdopt: () => boolean = () => true,
    ): Promise<
      HydratedStudioSession & {
        unanalyzedIds: Set<string>;
        nativeTreatmentIds: Set<string>;
      }
    > {
      await queue;
      const prior = await repository.read();
      if (legacy?.shots.length) {
        // This is merge-only: existing Develop history wins and legacy records remain archived.
        await repository.store.addPhotosWithDocuments(legacy.shots.map(developPhotoFromShot));
      }
      let current = legacy?.shots.length ? await repository.read() : prior;
      if (!prior.photos.length && legacy?.shots.length) {
        const selectedId = legacy.selectedId ? `studio:${legacy.selectedId}` : null;
        await repository.saveManifest(
          {
            photoIds: current.manifest.photoIds,
            selectedId:
              selectedId && current.manifest.photoIds.includes(selectedId)
                ? selectedId
                : current.manifest.selectedId,
            filter: legacy.filter,
          },
          current.manifest.revision,
        );
        current = await repository.read();
      }
      // Do not advance either review or view baselines for a stale asynchronous
      // refresh. The caller's newer K/X/selection gesture still owns this view.
      if (!mayAdopt()) throw new CullRefreshSuperseded();
      const unanalyzedIds = new Set<string>(),
        nativeTreatmentIds = new Set<string>();
      const shots = current.photos.map((photo) => {
        const document = current.documents[photo.id];
        if (!document)
          throw new Error("This saved photo has no editing document. No review was replaced.");
        const projected = projectDevelopPhotoToStudio(photo, document);
        const shot = projected.shot;
        if (baseline.has(shot.id) && baseline.get(shot.id)!.photoId !== photo.id)
          throw new Error(
            "Two saved photos share the same legacy review identity. No photos were merged.",
          );
        if (projected.needsAnalysis) unanalyzedIds.add(shot.id);
        if (projected.treatment === "native") nativeTreatmentIds.add(shot.id);
        const old = reusableFiles.get(photo.id);
        const media = photo.sourceBlob ?? photo.previewBlob;
        if (old && old.blob === media) shot.file = old.file;
        else reusableFiles.set(photo.id, { blob: media, file: shot.file });
        baseline.set(shot.id, {
          photoId: photo.id,
          review: { ...document.metadata },
          edits: { ...shot.edits },
        });
        return shot;
      });
      loaded = current;
      adoptedView = { selectedId: current.manifest.selectedId, filter: current.manifest.filter };
      return {
        shots,
        selectedId:
          shots.find((shot) => view.photoId(shot.id) === current.manifest.selectedId)?.id ?? null,
        filter: filters.has(current.manifest.filter as StudioFilter)
          ? (current.manifest.filter as StudioFilter)
          : "all",
        updatedAt: Date.now(),
        unanalyzedIds,
        nativeTreatmentIds,
      };
    },
    save(shots: readonly Shot[], selectedId: string | null, filter: StudioFilter): Promise<void> {
      // Capture the gesture, not a mutable caller array that can change while a prior save drains.
      const captured = shots.map((shot) => ({
        ...shot,
        edits: { ...shot.edits },
        ...(shot.develop ? { develop: { ...shot.develop } } : {}),
      }));
      const task = queue.then(async () => {
        if (!loaded || !adoptedView) throw new Error("Open this shoot before saving its review.");
        const current = await repository.read();
        const updates: { document: DevelopDocument; expectedRevision: number }[] = [];
        const reviewed: { shotId: string; value: Review }[] = [];
        for (const shot of captured) {
          const before = baseline.get(shot.id);
          if (!before) throw new Error("Import new photos in Develop before reviewing them.");
          if (!same(shot.edits, before.edits))
            throw new Error(
              "Photo treatments are edited in Develop. The preserved legacy settings were not overwritten.",
            );
          const next = reviewFromShot(shot, before.review);
          if (same(next, before.review)) continue;
          const saved = current.documents[before.photoId];
          if (!saved || !same(saved.metadata, before.review))
            throw new Error(
              "This photo's review changed elsewhere. Reload before saving your review.",
            );
          updates.push({
            document: { ...saved, metadata: next },
            expectedRevision: saved.revision,
          });
          reviewed.push({ shotId: shot.id, value: next });
        }
        if (updates.length) {
          await repository.store.saveDocuments(updates);
          for (const entry of reviewed) baseline.get(entry.shotId)!.review = { ...entry.value };
        }
        const nextSelected = selectedId ? view.photoId(selectedId) : null;
        if (selectedId && !nextSelected)
          throw new Error("The selected photo is not part of this shoot.");
        const loadedFilter = filters.has(adoptedView.filter as StudioFilter)
          ? adoptedView.filter
          : "all";
        if (nextSelected !== adoptedView.selectedId || filter !== loadedFilter) {
          if (
            current.manifest.selectedId !== adoptedView.selectedId ||
            current.manifest.filter !== adoptedView.filter
          )
            throw new Error(
              "This shoot's selection changed elsewhere. Reload before saving this view.",
            );
          await repository.saveManifest(
            {
              photoIds: current.manifest.photoIds,
              selectedId: nextSelected,
              filter: filter === loadedFilter ? current.manifest.filter : filter,
            },
            current.manifest.revision,
          );
          adoptedView = {
            selectedId: nextSelected,
            filter: filter === loadedFilter ? current.manifest.filter : filter,
          };
        }
        loaded = await repository.read();
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  return view;
}
