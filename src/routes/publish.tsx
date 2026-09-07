import { createFileRoute } from "@tanstack/react-router";
import { PublishDesk } from "@/components/business/PublishDesk";
export const Route = createFileRoute("/publish")({
  head: () => ({
    meta: [{ title: "Publish — LensLabs" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: PublishDesk,
});
