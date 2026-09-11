/** Visiting the public site never closes or replaces a remembered workspace. */
export function publicEntry(status: "loading" | "in" | "out" | undefined, local = false) {
  if (status === "in") return { to: "/dashboard" as const, search: {}, label: "Dashboard" };
  return {
    to: "/auth" as const,
    search: { next: "/dashboard", mode: "signup" as const },
    label: local ? "Open local workspace" : "Get started",
  };
}
