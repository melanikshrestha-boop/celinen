import { createFileRoute } from "@tanstack/react-router";
import { healthResponse } from "@/lib/build-version";

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: () => healthResponse() } },
});
