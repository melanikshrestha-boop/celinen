import { createFileRoute } from "@tanstack/react-router";
import { ShootSocialRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/$id/social")({ component: ShootSocialRoute });
