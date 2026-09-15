import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/mail")({
  head: () => ({
    meta: [{ title: "Gmail — Celinen" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => null,
});
