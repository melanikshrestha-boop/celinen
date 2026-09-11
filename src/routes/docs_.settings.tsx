import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/docs_/settings")({
  head: () => ({ meta: [{ title: "Settings guide — LensLabs" }] }),
  component: () => <SettingsGuide page="settings" />,
});
