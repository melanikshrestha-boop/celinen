import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/poses")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", search: { view: "calendar" } });
  },
});
