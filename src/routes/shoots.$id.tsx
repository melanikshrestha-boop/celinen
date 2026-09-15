import { createFileRoute } from "@tanstack/react-router";
import { ShootFrameRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/$id")({
  head: () => ({ meta: [{ title: "Shoot — Celinen" }] }),
  component: ShootFrameRoute,
});
