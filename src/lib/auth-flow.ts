import { isGalleryAcquisition } from "@/lib/delivery/experience";
import { safeSignInPath } from "@/lib/workbench";

export type AuthSearch = {
  next: string;
  mode?: "signin" | "signup";
  source?: "client-gallery";
  google?: boolean;
};

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  const fromGallery = isGalleryAcquisition(search["source"]);
  return {
    next: fromGallery
      ? "/deliver?workflow=1"
      : typeof search["next"] === "string"
        ? safeSignInPath(search["next"])
        : "/dashboard",
    mode: search["mode"] === "signin" ? "signin" : "signup",
    ...(fromGallery ? { source: "client-gallery" as const } : {}),
    ...(search["google"] === true || search["google"] === "1" ? { google: true } : {}),
  };
}

export function authReturnUrl(
  origin: string,
  next: string,
  fromGallery = false,
  mode: "signin" | "signup" = "signup",
) {
  const target = new URL("/auth", origin);
  target.searchParams.set("next", safeSignInPath(next));
  target.searchParams.set("mode", mode);
  if (fromGallery) target.searchParams.set("source", "client-gallery");
  return target.toString();
}

/** Where a private page sends a signed-out visitor; `next` returns them to that exact page. */
export function signInHref(href: string) {
  return `/auth?next=${encodeURIComponent(safeSignInPath(href))}&mode=signin`;
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
