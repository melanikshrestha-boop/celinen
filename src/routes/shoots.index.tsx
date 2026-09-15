import { createFileRoute } from "@tanstack/react-router";
import { ShootHubRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/")({
  head: () => ({ meta: [{ title: "Shoots — Celinen" }] }),
  component: () => <ShootHubRoute view="shoots" />,
});
