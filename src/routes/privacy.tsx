import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/components/marketing/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Celinen" },
      {
        name: "description",
        content:
          "How Celinen handles photographer data, including GDPR rights for the EEA, UK, and Switzerland.",
      },
    ],
  }),
  component: PrivacyPage,
});
