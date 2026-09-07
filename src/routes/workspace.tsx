import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [{ title: "Workspace — LensLabs" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => null,
});
