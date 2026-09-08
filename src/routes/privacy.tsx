import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy policy — LensLabs" }] }),
  component: () => <SettingsGuide page="privacy" />,
});
