import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Help — LensLabs" }] }),
  component: () => <SettingsGuide page="help" />,
});
