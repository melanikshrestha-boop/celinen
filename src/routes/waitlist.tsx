import { createFileRoute, redirect } from "@tanstack/react-router";

/** The waitlist is closed for good; sign-up is open. */
export const Route = createFileRoute("/waitlist")({
  beforeLoad: () => {
    throw redirect({ to: "/signup", search: { plan: "starter", billing: "yearly" } });
  },
});
