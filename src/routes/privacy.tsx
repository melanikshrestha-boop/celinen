import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/components/marketing/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — FOTO" },
      {
        name: "description",
        content:
          "How FOTO handles photographer data, including GDPR rights for the EEA, UK, and Switzerland.",
      },
    ],
  }),
  component: PrivacyPage,
});
