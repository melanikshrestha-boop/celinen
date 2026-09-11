import { createFileRoute } from "@tanstack/react-router";
import { ShootHubRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/library")({
  head: () => ({ meta: [{ title: "Library — FOTO" }] }),
  component: () => <ShootHubRoute view="library" />,
});
