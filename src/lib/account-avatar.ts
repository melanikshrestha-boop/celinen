import { workspaceStorageKey } from "./workspace-storage";

/** Device-local profile photos. JWT user_metadata stays tiny; the chip reads this first. */
export const AVATAR_LOCAL_LIMIT = 80_000;
export const avatarStorageKey = (scope: string) =>
  workspaceStorageKey("lenslabs.avatar.v1", scope);

const jpeg =
  /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/;

export function isAvatarDataUrl(value: string) {
  return value === "" || (value.length <= AVATAR_LOCAL_LIMIT && jpeg.test(value));
}

export function readLocalAvatar(scope: string | null): string | undefined {
  if (!scope || typeof localStorage === "undefined") return undefined;
  try {
    const value = localStorage.getItem(avatarStorageKey(scope));
    if (value === null) return undefined;
    return isAvatarDataUrl(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalAvatar(scope: string, avatar: string) {
  if (!isAvatarDataUrl(avatar)) throw new Error("Choose a cropped JPEG profile image.");
  localStorage.setItem(avatarStorageKey(scope), avatar);
}
