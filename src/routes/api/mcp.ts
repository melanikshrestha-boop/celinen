import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "@/lib/foto-mcp";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMcpRequest(request),
      POST: async ({ request }) => handleMcpRequest(request),
      OPTIONS: async ({ request }) => handleMcpRequest(request),
    },
  },
});
