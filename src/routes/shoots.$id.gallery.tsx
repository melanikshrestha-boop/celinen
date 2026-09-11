import { createFileRoute } from "@tanstack/react-router";
import { ShootGalleryRoute } from "./-shoot-workspace";
export const Route = createFileRoute("/shoots/$id/gallery")({ component: ShootGalleryRoute });
