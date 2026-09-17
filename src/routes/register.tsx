import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/register")({
  beforeLoad: () => {
    throw redirect({ to: "/auth", search: { next: "/dashboard", mode: "signup" } });
  },
});
