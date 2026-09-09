import type { MouseEvent } from "react";
import { Camera, Clock3, Grid2X2, Send, UsersRound, Wallet } from "lucide-react";

/** One global navigation. Editing lives inside a shoot. */
export const FOTO_PRIMARY_NAV = [
  { href: "/tonight", label: "Tonight", Icon: Clock3 },
  { href: "/shoots", label: "Shoots", Icon: Camera },
  { href: "/clients", label: "Clients", Icon: UsersRound },
  { href: "/library", label: "Library", Icon: Grid2X2 },
  { href: "/deliver", label: "Deliver", Icon: Send },
  { href: "/earnings", label: "Earnings", Icon: Wallet },
] as const;
export function primaryNavigationPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (path.startsWith("/shoots/")) return "/shoots";
  if (path === "/money") return "/earnings";
  return FOTO_PRIMARY_NAV.find((item) => item.href === path)?.href ?? null;
}
export function followNavigation(event: MouseEvent, href: string, open: (href: string) => unknown) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  void open(href);
}
