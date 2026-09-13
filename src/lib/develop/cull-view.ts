import type { Shot } from "../imaging";
import { createLightroomVerdicts, mergeLightroomFrames } from "../lightroom-matching";
import { applyProposal, sameEdits, type StudioProposal } from "../studio/proposals";
import type { HydratedStudioSession, StudioFilter } from "../studio/session";
import {
  developPhotosFromStudio,
  DevelopSaveConflict,
  mergeDevelopImportCommit,
  type DevelopDocument,
  type DevelopLibrary,
  type DevelopStoreChange,
  type ShootManifest,
} from "./store";
import { developAnalysisFromShot, readDevelopPhotoAnalysis } from "./analysis";
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
  const reusableFiles = new Map<string, { blob: Blob | null; file: File; identity: string }>();
  let queue: Promise<unknown> = Promise.resolve();
  const view = {
    photoId(shotId: string): string | null {
      return baseline.get(shotId)?.photoId ?? null;
    },
    async read(
      legacy?: HydratedStudioSession | null,
      mayAdopt: () => boolean = () => true,
      changes?: readonly DevelopStoreChange[],
    ): Promise<
      HydratedStudioSession & {
        unanalyzedIds: Set<string>;
        nativeTreatmentIds: Set<string>;
      }
    > {
      await queue;
      let prior: Snapshot;
      if (
        !legacy?.shots.length &&
        loaded &&
        changes?.length &&
        changes.every((change) => change.kind === "photos" && change.commit)
      ) {
        // Combine an import burst once, preserving the latest receipt per photo.
        // Cross-tab/missing receipts keep the full-read fallback below.
        const photos = new Map<string, DevelopLibrary["photos"][number]>();
        const documents: DevelopLibrary["documents"] = Object.create(null);
        for (const change of changes) {
          const receipt = change.commit!;
          if (receipt.photos.length !== Object.keys(receipt.documents).length)
            throw new Error("The committed photo and edit receipt does not match.");
          for (const photo of receipt.photos) {
            const document = receipt.documents[photo.id];
            if (
              !document ||
              document.photoId !== photo.id ||
              (documents[photo.id] && documents[photo.id]!.revision > document.revision)
            )
              throw new Error("The committed photo and edit receipt does not match.");
            photos.set(photo.id, photo);
            documents[photo.id] = document;
          }
        }
        let merged: DevelopLibrary | null = null;
        try {
          merged = mergeDevelopImportCommit(loaded, {
            photos: [...photos.values()],
            documents,
          });
        } catch (error) {
          if (!(error instanceof DevelopSaveConflict)) throw error;
          // The route flushes gestures before replaying buffered import events.
          // An older receipt is no longer a usable optimization, not a failed
          // save. Discard that fast path and validate the durable library below.
        }
        if (merged) {
          const manifest = await repository.readManifest();
          const indexed = new Map(merged.photos.map((photo) => [photo.id, photo]));
          prior =
            manifest.photoIds.length === indexed.size &&
            manifest.photoIds.every((id) => indexed.has(id))
              ? { ...merged, photos: manifest.photoIds.map((id) => indexed.get(id)!), manifest }
              : await repository.read();
        } else prior = await repository.read();
      } else prior = await repository.read();
      if (legacy?.shots.length) {
        // This is merge-only: existing Develop history wins and legacy records remain archived.
        await repository.store.addPhotosWithDocuments(
          developPhotosFromStudio(legacy.shots, prior, repository.namespace),
        );
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
        const projected = projectDevelopPhotoToStudio(photo, document, repository.namespace);
        const shot = projected.shot;
        if (baseline.has(shot.id) && baseline.get(shot.id)!.photoId !== photo.id)
          throw new Error(
            "Two saved photos share the same legacy review identity. No photos were merged.",
          );
        if (projected.needsAnalysis) unanalyzedIds.add(shot.id);
        if (projected.treatment === "native") nativeTreatmentIds.add(shot.id);
        const old = reusableFiles.get(photo.id);
        const media = shot.sourceAvailable ? photo.sourceBlob : photo.previewBlob;
        const identity = JSON.stringify([
          repository.namespace,
          photo.createdAt,
          photo.sourceDigest,
          shot.sourceAvailable,
          photo.sourceFileName,
          photo.sourceLastModified,
          photo.isRaw,
          shot.file.name,
          shot.file.lastModified,
          shot.file.size,
          shot.file.type,
        ]);
        // A full IndexedDB read clones Blob handles, not original content. The
        // canonical import verifies full SHA-256 identities; the store never
        // replaces an attached original. Reuse it only within this view's
        // account/shoot, so refresh does not discard in-flight analysis/admission.
        // Missing sources, previews and unverified legacy digests cannot use this
        // path. Keep the asynchronous File-identity fence in Studio unchanged.
        const verifiedOriginal =
          Boolean(repository.namespace) &&
          shot.sourceAvailable &&
          /^sha256:[a-f0-9]{64}$/.test(photo.sourceDigest ?? "");
        if (old && old.identity === identity && (old.blob === media || verifiedOriginal))
          shot.file = old.file;
        else reusableFiles.set(photo.id, { blob: media, file: shot.file, identity });
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
        roster: legacy?.roster ?? [],
        eventPeople: legacy?.eventPeople ?? [],
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
        ...(shot.tone ? { tone: { ...shot.tone } } : {}),
        ...(shot.faces ? { faces: structuredClone(shot.faces) } : {}),
      }));
      const task = queue.then(async () => {
        if (!loaded || !adoptedView) throw new Error("Open this shoot before saving its review.");
        const indexed = new Map(loaded.photos.map((photo) => [photo.id, photo]));
        const pending = [];
        for (const shot of captured) {
          const before = baseline.get(shot.id);
          if (!before) throw new Error("Import new photos in Develop before reviewing them.");
          if (!same(shot.edits, before.edits))
            throw new Error(
              "Photo treatments are edited in Develop. The preserved legacy settings were not overwritten.",
            );
          const next = reviewFromShot(shot, before.review);
          const photo = indexed.get(before.photoId);
          if (!photo) throw new Error("The reviewed photo is not in this shoot.");
          const oldAnalysis = readDevelopPhotoAnalysis(
            photo,
            loaded.documents[photo.id],
            repository.namespace,
          );
          const analysis = developAnalysisFromShot(
            shot,
            photo,
            repository.namespace,
            oldAnalysis ?? undefined,
          );
          const reviewChanged = !same(next, before.review);
          const analysisChanged = analysis !== null && !same(analysis, oldAnalysis);
          if (reviewChanged || analysisChanged)
            pending.push({
              shot,
              before,
              next,
              photo,
              oldAnalysis,
              analysis,
              reviewChanged,
              analysisChanged,
            });
        }
        const nextSelected = selectedId ? view.photoId(selectedId) : null;
        if (selectedId && !nextSelected)
          throw new Error("The selected photo is not part of this shoot.");
        const loadedFilter = filters.has(adoptedView.filter as StudioFilter)
          ? adoptedView.filter
          : "all";
        const viewChanged = nextSelected !== adoptedView.selectedId || filter !== loadedFilter;
        // Canonical refreshes and flush fences are not new review gestures.
        if (!pending.length && !viewChanged) return;
        const currentDocuments = pending.length
          ? repository.store.readDocuments
            ? await repository.store.readDocuments(pending.map((entry) => entry.photo.id))
            : (await repository.read()).documents
          : {};
        const updates: { document: DevelopDocument; expectedRevision: number }[] = [];
        for (const entry of pending) {
          const { shot, before, next, photo, oldAnalysis, reviewChanged, analysisChanged } = entry;
          const saved = currentDocuments[photo.id];
          if (!saved || (reviewChanged && !same(saved.metadata, before.review)))
            throw new Error(
              "This photo's review changed elsewhere. Reload before saving your review.",
            );
          const currentAnalysis = readDevelopPhotoAnalysis(photo, saved, repository.namespace);
          const analysis = analysisChanged
            ? developAnalysisFromShot(
                shot,
                photo,
                repository.namespace,
                currentAnalysis ?? undefined,
              )
            : currentAnalysis;
          if (
            analysisChanged &&
            !same(currentAnalysis, oldAnalysis) &&
            !same(analysis, currentAnalysis)
          )
            throw new Error(
              "This photo's analysis changed elsewhere. Reload before saving its measurements.",
            );
          updates.push({
            document: {
              ...saved,
              metadata: reviewChanged ? next : saved.metadata,
              ...(analysis ? { analysis } : {}),
            },
            expectedRevision: saved.revision,
          });
        }
        if (updates.length) {
          const saved = await repository.store.saveDocuments(updates);
          for (const document of saved) loaded.documents[document.photoId] = document;
          for (const entry of pending)
            if (entry.reviewChanged) baseline.get(entry.shot.id)!.review = { ...entry.next };
        }
        if (viewChanged) {
          const manifest = repository.readManifest
            ? await repository.readManifest()
            : (await repository.read()).manifest;
          if (
            manifest.selectedId !== adoptedView.selectedId ||
            manifest.filter !== adoptedView.filter
          )
            throw new Error(
              "This shoot's selection changed elsewhere. Reload before saving this view.",
            );
          loaded.manifest = await repository.saveManifest(
            {
              photoIds: manifest.photoIds,
              selectedId: nextSelected,
              filter: filter === loadedFilter ? manifest.filter : filter,
            },
            manifest.revision,
          );
          adoptedView = {
            selectedId: nextSelected,
            filter: filter === loadedFilter ? manifest.filter : filter,
          };
        }
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  return view;
}
