import { createFileRoute } from "@tanstack/react-router";
import { AppDashboard } from "@/components/dashboard/AppDashboard";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === "calendar" ? ("calendar" as const) : undefined,
  }),
  head: () => ({
    meta: [{ title: `Chat — ${PRODUCT_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AppDashboard,
});
