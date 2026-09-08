import { createFileRoute } from "@tanstack/react-router";
import { ShootSmartFileRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/$id/smart-file")({ component: ShootSmartFileRoute });
