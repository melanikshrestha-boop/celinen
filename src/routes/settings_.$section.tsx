import { createFileRoute, notFound } from "@tanstack/react-router";
import { Settings } from "@/components/account/SettingsPage";
import { isSettingsPath, SETTINGS_SECTIONS, settingsSection } from "@/lib/settings-catalog";

export const Route = createFileRoute("/settings_/$section")({
  beforeLoad: ({ params }) => {
    if (!isSettingsPath(`/settings/${params.section}`)) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      {
        title: `${SETTINGS_SECTIONS.find((entry) => entry.id === settingsSection(params.section))!.label} — LensLabs Settings`,
      },
    ],
  }),
  component: Settings,
});
