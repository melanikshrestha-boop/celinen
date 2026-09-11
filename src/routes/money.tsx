import { createFileRoute } from "@tanstack/react-router";
import { LegacyWorkbenchRedirect } from "./-legacy-redirect";
export const Route = createFileRoute("/money")({
  head: () => ({ meta: [{ title: "Earnings — FOTO" }] }),
  component: LegacyWorkbenchRedirect,
});
