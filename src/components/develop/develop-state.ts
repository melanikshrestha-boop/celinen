/** Preview provenance includes geometry, not every slider value: ordinary edits
 * keep their last preview while rendering, but source-space tools never use a
 * cropped/rotated frame as their coordinate surface. */
export type DevelopRenderOwner = {
  id: string | null;
  source: Blob;
  sourceGeometry: boolean;
  renderKey?: string;
};
export function currentDevelopRender(
  owner: DevelopRenderOwner | null,
  id: string | null,
  source: Blob | null,
  sourceGeometry: boolean,
  renderKey?: string,
): boolean {
  return Boolean(
    owner &&
    source &&
    owner.id === id &&
    owner.source === source &&
    owner.sourceGeometry === sourceGeometry &&
    (renderKey === undefined || owner.renderKey === renderKey),
  );
}
/** A RAW's sensor data, decoded for this session and this photo only.
 *
 * It is deliberately not written to the library: a stored preview is the
 * photographer's, and a decode that goes wrong must not be able to replace it.
 * The cost is one decode per photo per session, which is well under a second.
 */
export type DevelopSensorRender = {
  /** The photo this belongs to; a render is never shown against another. */
  id: string;
  blob: Blob;
  width: number;
  height: number;
  /** The white balance the render used, in real Kelvin. */
  kelvin: number;
  tint: number;
  /** False when the file recorded none and the profile's daylight was assumed. */
  whiteBalanceFromFile: boolean;
  /** Wall-clock milliseconds the decode took. */
  elapsed: number;
};

/** One explicit source for editor, before/histogram, assistance and export.
 * RAW mode never silently substitutes a saved JPEG for an available original. */
export function developProcessingSource(
  photo: {
    isRaw: boolean;
    sourceAvailable: boolean;
    sourceBlob: Blob | null;
    previewBlob: Blob | null;
  } | null,
  requestedMode: "raw" | "preview",
): { source: Blob | null; sourceMode: "raw" | "preview" } {
  if (!photo) return { source: null, sourceMode: "preview" };
  const original = photo.sourceAvailable && photo.sourceBlob?.size ? photo.sourceBlob : null;
  const preview = photo.previewBlob?.size ? photo.previewBlob : null;
  if (!photo.isRaw) return { source: original ?? preview, sourceMode: "preview" };
  if (requestedMode === "raw" && original) return { source: original, sourceMode: "raw" };
  return { source: preview ?? original, sourceMode: "preview" };
}
export function developImageReady(loadedUrl: string | null, displayedUrl: string | null): boolean {
  return Boolean(displayedUrl && loadedUrl === displayedUrl);
}

/** Export previews are the downloadable JPEG, not the editor's fast proxy.
 * Reuse requires every render input, including the source object, to match. */
export type DevelopExportRequest = {
  id: string;
  source: Blob;
  recipeKey: string;
  edge: number;
  quality: number;
  sourceMode: "raw" | "preview";
  /** Border + watermark kit fingerprint; proof reuse requires an exact match. */
  dressingKey: string;
};
export type DevelopExportProof = DevelopExportRequest & {
  blob: Blob;
  width: number;
  height: number;
};
export function currentDevelopExportProof(
  proof: DevelopExportProof | null,
  request: DevelopExportRequest | null,
): boolean {
  return Boolean(
    proof &&
    request &&
    proof.id === request.id &&
    proof.source === request.source &&
    proof.recipeKey === request.recipeKey &&
    proof.edge === request.edge &&
    proof.quality === request.quality &&
    proof.sourceMode === request.sourceMode &&
    proof.dressingKey === request.dressingKey,
  );
}
/** Filtering cannot leave invisible edit targets selected or active. */
export function filteredDevelopSelection(
  visibleIds: readonly string[],
  activeId: string | null,
  selectedIds: ReadonlySet<string>,
): { activeId: string | null; selectedIds: Set<string> } {
  const visible = new Set(visibleIds);
  const active = activeId && visible.has(activeId) ? activeId : (visibleIds[0] ?? null);
  const selected = new Set([...selectedIds].filter((id) => visible.has(id)));
  if (active) selected.add(active);
  return { activeId: active, selectedIds: selected };
}

/** The library filters, in one place: the toolbar, the visible list and
 * changeFilter must agree, and an unknown value must mean "all" rather than
 * falling through to whichever branch happens to be last. */
export const DEVELOP_FILTERS = ["all", "picks", "hearted", "rated", "not-rejected"] as const;
export type DevelopFilter = (typeof DEVELOP_FILTERS)[number];

export function developFilterMatches(
  filter: string,
  metadata: { rating?: number; flag?: "pick" | "reject" | null; hearted?: boolean } | undefined,
): boolean {
  switch (filter) {
    case "picks":
      return metadata?.flag === "pick";
    case "hearted":
      return metadata?.hearted === true;
    case "rated":
      return (metadata?.rating ?? 0) >= 3;
    case "not-rejected":
      return metadata?.flag !== "reject";
    default:
      return true;
  }
}
