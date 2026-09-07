import { isGalleryAcquisition } from "@/lib/delivery/experience";
import { safeSignInPath } from "@/lib/workbench";

export type AuthSearch = {
  next: string;
  mode?: "signin" | "signup";
  source?: "client-gallery";
};

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  const fromGallery = isGalleryAcquisition(search["source"]);
  return {
    next: fromGallery
      ? "/deliver?workflow=1"
      : typeof search["next"] === "string"
        ? safeSignInPath(search["next"])
        : "/workspace",
    mode: search["mode"] === "signin" ? "signin" : "signup",
    ...(fromGallery ? { source: "client-gallery" as const } : {}),
  };
}

export function authReturnUrl(origin: string, next: string, fromGallery = false) {
  const target = new URL("/auth", origin);
  target.searchParams.set("next", safeSignInPath(next));
  target.searchParams.set("mode", "signup");
  if (fromGallery) target.searchParams.set("source", "client-gallery");
  return target.toString();
}

export function isLocalAuthOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}
