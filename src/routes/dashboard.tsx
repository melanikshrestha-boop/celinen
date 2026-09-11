import { createFileRoute } from "@tanstack/react-router";
import { AppDashboard } from "@/components/dashboard/AppDashboard";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: `Dashboard — ${PRODUCT_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AppDashboard,
});
