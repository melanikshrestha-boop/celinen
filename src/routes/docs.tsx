import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/docs")({
  head: () => ({ meta: [{ title: "Documentation — LensLabs" }] }),
  component: () => <SettingsGuide page="docs" />,
});
