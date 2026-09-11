import { createFileRoute } from "@tanstack/react-router";
import { ShootCullRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/$id/cull")({ component: ShootCullRoute });
