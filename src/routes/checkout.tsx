import { createFileRoute, redirect } from "@tanstack/react-router";

/** Checkout lives on /signup: Stripe when payments are configured, free Google sign-up when not. */
export const Route = createFileRoute("/checkout")({
  validateSearch: (search: Record<string, unknown>): { plan?: string; billing?: "monthly" } => ({
    ...(typeof search["plan"] === "string" && search["plan"] ? { plan: search["plan"] } : {}),
    ...(search["billing"] === "monthly" ? { billing: "monthly" as const } : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/signup",
      search: { plan: search.plan ?? "starter", billing: search.billing ?? "yearly" },
    });
  },
});
