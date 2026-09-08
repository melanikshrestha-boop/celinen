import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/components/account/SettingsPage";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LensLabs" }] }),
  component: Settings,
});
