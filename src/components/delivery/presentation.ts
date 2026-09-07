import type { Actor, DeliveryPhoto, VariantName } from "@/lib/delivery/workflow";
export const sizeLabel = (bytes: number) =>
  bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
export type MediaReader = (
  ids: string[],
  kind: VariantName,
) => Promise<{ versionId: string; url: string }[]>;
export function currentVersion(photo: DeliveryPhoto, actor: Actor) {
  return photo.versions.find((v) => v.id === (actor === "owner" ? photo.current : photo.published));
}
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Please retry.";
