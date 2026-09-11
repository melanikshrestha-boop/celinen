import { createFileRoute } from "@tanstack/react-router";
import { StudioDesk } from "@/components/studio-desk/StudioDesk";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/bookings")({
  head: () => ({
    meta: [{ title: `Bookings — ${PRODUCT_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: StudioDesk,
});
