import { createFileRoute } from "@tanstack/react-router";
import { SocialAccounts } from "@/components/dashboard/SocialAccounts";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/publish")({
  head: () => ({
    meta: [{ title: `Social accounts — ${PRODUCT_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: SocialAccounts,
});
