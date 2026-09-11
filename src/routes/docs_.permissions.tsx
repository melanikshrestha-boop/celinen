import { createFileRoute } from "@tanstack/react-router";
import { SettingsGuide } from "@/components/account/SettingsGuide";

export const Route = createFileRoute("/docs_/permissions")({
  head: () => ({ meta: [{ title: "Workspace permissions — LensLabs" }] }),
  component: () => <SettingsGuide page="permissions" />,
});
