import { createFileRoute } from "@tanstack/react-router";
import { geocodePlaces } from "@/lib/maps-places";

export const Route = createFileRoute("/api/places")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        const key = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";
        const hits = await geocodePlaces(q, key);
        return Response.json({ hits });
      },
    },
  },
});
