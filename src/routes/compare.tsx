import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/compare")({
  component: Outlet,
});
