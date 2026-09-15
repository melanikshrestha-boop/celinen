import { createFileRoute } from "@tanstack/react-router";
import { PhotographerNetwork } from "@/components/commerce/PhotographerNetwork";
export const Route = createFileRoute("/network")({
  head: () => ({
    meta: [
      { title: "Photographer network — Celinen" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PhotographerNetwork,
});
