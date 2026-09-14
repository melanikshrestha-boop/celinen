import { createFileRoute } from "@tanstack/react-router";
import { versionResponse } from "@/lib/build-version";

export const Route = createFileRoute("/api/version")({
  server: { handlers: { GET: () => versionResponse() } },
});
