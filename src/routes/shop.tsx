import { createFileRoute } from "@tanstack/react-router";
import { CommerceDesk } from "@/components/commerce/CommerceDesk";
export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [{ title: "Print shop — Celinen" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CommerceDesk,
});
