import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/security")({
  head: () => ({ meta: [{ title: "Security information — LensLabs" }] }),
  component: () => <SettingsGuide page="security" />,
});
