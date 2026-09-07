/** Visiting the public site never closes or replaces a remembered workspace. */
export function publicEntry(status: "loading" | "in" | "out" | undefined, local = false) {
  if (status === "in") return { to: "/workspace" as const, search: {}, label: "Open workspace" };
  return {
    to: "/auth" as const,
    search: { next: "/workspace", mode: "signup" as const },
    label: local ? "Open local workspace" : "Get started",
  };
}
