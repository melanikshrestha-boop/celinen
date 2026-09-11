import { createFileRoute } from "@tanstack/react-router";
import { TermsPage } from "@/components/marketing/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — FOTO" },
      {
        name: "description",
        content: "Terms for using FOTO, the photography workspace at lenslab.dev.",
      },
    ],
  }),
  component: TermsPage,
});
