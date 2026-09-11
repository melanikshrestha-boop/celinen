import { createFileRoute } from "@tanstack/react-router";
import { LegacyWorkbenchRedirect } from "./-legacy-redirect";

export const Route = createFileRoute("/develop")({
  head: () => ({ meta: [{ title: "Develop — FOTO Photo Lab" }] }),
  component: LegacyWorkbenchRedirect,
});
