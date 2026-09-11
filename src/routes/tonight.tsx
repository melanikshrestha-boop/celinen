import { createFileRoute } from "@tanstack/react-router";
import { ShootHubRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/tonight")({
  head: () => ({ meta: [{ title: "Tonight — FOTO" }] }),
  component: () => <ShootHubRoute view="tonight" />,
});
