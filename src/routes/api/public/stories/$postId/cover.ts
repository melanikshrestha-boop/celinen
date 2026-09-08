import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stories/$postId/cover")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        (await import("@/lib/business/story-cover.server")).storyCoverResponse(params.postId),
    },
  },
});
