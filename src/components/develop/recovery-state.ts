import type { DevelopLibrary, DevelopRecovery } from "@/lib/develop/store";

/** The checklist is limited to existing photo/document pairs; it never creates IDs. */
export function developRecoveryAvailability(recovery: DevelopRecovery, library: DevelopLibrary) {
  const found = new Set<string>();
  const photos: { id: string; name: string }[] = [];
  for (const photo of library.photos) {
    if (
      found.has(photo.id) ||
      !Object.hasOwn(recovery.documents, photo.id) ||
      !Object.hasOwn(library.documents, photo.id) ||
      library.documents[photo.id]?.photoId !== photo.id
    )
      continue;
    found.add(photo.id);
    photos.push({ id: photo.id, name: photo.name });
  }
  return {
    photos,
    missingPhotoIds: Object.keys(recovery.documents).filter((id) => !found.has(id)),
  };
}
