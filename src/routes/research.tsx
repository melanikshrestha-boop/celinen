import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [{ title: "Web research — Celinen" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => null,
});
