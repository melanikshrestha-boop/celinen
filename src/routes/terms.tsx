import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of service — LensLabs" }] }),
  component: () => <SettingsGuide page="terms" />,
});
