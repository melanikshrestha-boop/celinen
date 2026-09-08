/** Preview provenance includes geometry, not every slider value: ordinary edits
 * keep their last preview while rendering, but source-space tools never use a
 * cropped/rotated frame as their coordinate surface. */
export type DevelopRenderOwner = {
  id: string | null;
  source: Blob;
  sourceGeometry: boolean;
};
export function currentDevelopRender(
  owner: DevelopRenderOwner | null,
  id: string | null,
  source: Blob | null,
  sourceGeometry: boolean,
): boolean {
  return Boolean(
    owner &&
    source &&
    owner.id === id &&
    owner.source === source &&
    owner.sourceGeometry === sourceGeometry,
  );
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
    proof.sourceMode === request.sourceMode,
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
