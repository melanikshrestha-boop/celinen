import type { MouseEvent } from "react";
import { Camera, Clock3, Grid2X2, Send, Wallet } from "lucide-react";

/** One global navigation. Editing lives inside a shoot, never beside Money. */
export const FOTO_PRIMARY_NAV = [
  { href: "/tonight", label: "Tonight", Icon: Clock3 },
  { href: "/shoots", label: "Shoots", Icon: Camera },
  { href: "/library", label: "Library", Icon: Grid2X2 },
  { href: "/deliver", label: "Deliver", Icon: Send },
  { href: "/money", label: "Money", Icon: Wallet },
] as const;
export function primaryNavigationPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (path.startsWith("/shoots/")) return "/shoots";
  return FOTO_PRIMARY_NAV.find((item) => item.href === path)?.href ?? null;
}
export function followNavigation(event: MouseEvent, href: string, open: (href: string) => unknown) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  void open(href);
}
