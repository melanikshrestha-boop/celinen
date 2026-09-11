import { createFileRoute } from "@tanstack/react-router";
import { ShootDevelopRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/$id/develop")({ component: ShootDevelopRoute });
