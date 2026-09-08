import { createFileRoute } from "@tanstack/react-router";
import { LegacyWorkbenchRedirect } from "./-legacy-redirect";
export const Route = createFileRoute("/jobs")({ component: LegacyWorkbenchRedirect });
