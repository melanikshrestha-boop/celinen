import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [{ title: "Web research — LensLabs" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => null,
});
