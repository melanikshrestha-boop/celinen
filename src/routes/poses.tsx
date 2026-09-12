import { createFileRoute } from "@tanstack/react-router";
import { Poses } from "@/components/dashboard/Poses";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/poses")({
  validateSearch: (search: Record<string, unknown>) => ({
    shoot: typeof search.shoot === "string" && search.shoot.length > 0 && search.shoot.length <= 80
      ? search.shoot
      : undefined,
  }),
  head: () => ({
    meta: [{ title: `Poses — ${PRODUCT_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: PosesRoute,
});

function PosesRoute() {
  const { shoot } = Route.useSearch();
  return <Poses shoot={shoot} />;
}
