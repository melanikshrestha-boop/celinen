import { createFileRoute, redirect } from "@tanstack/react-router";

// Home is the dashboard. The older workspace home is kept as a component for the
// legacy tool pages that still use its chrome, but this address leads Home.
export const Route = createFileRoute("/workspace")({
  beforeLoad: () => {
    throw redirect({ href: "/dashboard", replace: true });
  },
});
