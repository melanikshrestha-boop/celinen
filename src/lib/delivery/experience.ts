import { downloadable, selectionsLocked, type DeliveryState } from "./workflow";
import { galleryPresentation } from "./gallery-presentation";

// Deliberately constant: no invitation, gallery ID, client name, or referrer goes to acquisition.
export const gallerySignupPath =
  "/auth?mode=signup&source=client-gallery&next=%2Fdeliver%3Fworkflow%3D1";
export function isGalleryAcquisition(source: unknown): source is "client-gallery" {
  return source === "client-gallery";
}

export function invitationGeneration(state: DeliveryState): string | null {
  for (let index = state.events.length - 1; index >= 0; index--) {
    const event = state.events[index]!;
    if (
      event.role === "owner" &&
      (event.text === "Private invitation replaced; previous link revoked" ||
        event.text.startsWith("Gallery closed"))
    )
      return event.id;
  }
  return null;
}

/** A late clipboard result must never label a different gallery/account as copied. */
export async function copyGalleryText(
  text: string,
  write: (text: string) => Promise<void>,
  current: () => boolean,
  copied: () => void,
  failed: (cause: unknown) => void,
) {
  if (!current()) return;
  try {
    await write(text);
    if (current()) copied();
  } catch (cause) {
    if (current()) failed(cause);
  }
}

export function galleryInvitation(state: DeliveryState, privateUrl: string, now: string): string {
  const url = new URL(privateUrl);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/review\/[0-9a-f-]{36}$/.test(url.pathname) ||
    !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)
  )
    throw new Error("Create a valid private gallery invitation first.");
  if (state.status !== "live" || Date.parse(state.expiresAt) <= Date.parse(now))
    throw new Error("Reopen and publish the gallery before sharing it.");
  const presentation = galleryPresentation(state);
  const finals = state.photos.filter(
    (photo) => photo.published && downloadable(state, photo.published, now),
  ).length;
  const instruction = finals
    ? `${finals} approved ${finals === 1 ? "photo is" : "photos are"} ready to download. Choose phone-size or high-resolution files.`
    : selectionsLocked(state)
      ? "Review the current edits and leave any changes on the photo they belong to."
      : `Choose up to ${state.selectionLimit} favourites, leave any notes on each photo, then submit your selection.`;
  const expiry = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(state.expiresAt),
  );
  return [
    `Hi ${state.clientName},`,
    "",
    `Your gallery, ${state.title}, is ready.`,
    "",
    privateUrl,
    "",
    instruction,
    `Available until ${expiry} (UTC). Save your final files before it expires.`,
    "No new account needed. Keep this link private: everyone with it shares the same selections and feedback.",
    ...(presentation.studioName ? ["", presentation.studioName] : []),
    ...(presentation.showLensLabsCredit ? ["Delivered with LensLabs"] : []),
  ].join("\n");
}
