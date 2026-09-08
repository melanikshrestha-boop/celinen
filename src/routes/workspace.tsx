import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT_NAME } from "@/lib/product";
export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [{ title: PRODUCT_NAME }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => null,
});
