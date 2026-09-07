import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount as requireSupabaseAuth } from "./auth.functions";
import { publicationInput } from "./publishing";
const auth: [typeof businessAuth, typeof requireSupabaseAuth] = [businessAuth, requireSupabaseAuth];
export const publishingStatus = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => {
    const ig = await import("./instagram.server");
    const configured = ig.instagramConfigured();
    const connection = await ig.instagramConnection(context.userId);
    const posts = await (await import("./publishing.server")).listPublications(context.userId);
    return {
      configured,
      portfolioUrl: `/photographer/${context.userId}`,
      connection: connection
        ? {
            username: connection.username,
            expiresAt: connection.expires_at,
            active: Date.parse(connection.expires_at) > Date.now() + 60000,
          }
        : null,
      posts,
    };
  });
export const connectInstagram = createServerFn({ method: "POST" })
  .middleware(auth)
  .handler(async ({ context }) =>
    (await import("./instagram.server")).startInstagram(context.userId),
  );
export const completeInstagram = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(
    z
      .object({ code: z.string().min(1).max(4000), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict(),
  )
  .handler(async ({ context, data }) =>
    (await import("./instagram.server")).finishInstagram(context.userId, data.code, data.state),
  );
export const disconnectInstagram = createServerFn({ method: "POST" })
  .middleware(auth)
  .handler(async ({ context }) => {
    const db = (await import("./database.server")).businessDatabase();
    const { error } = await db.from("social_connections").delete().eq("owner_id", context.userId);
    if (error) throw new Error("Could not disconnect Instagram. Retry.");
    // Disconnect only removes the saved credential; revoke the app in Instagram to revoke the grant.
    return { disconnected: true };
  });
export const savePublication = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(publicationInput)
  .handler(async ({ context, data }) =>
    (await import("./publishing.server")).createPublication(context.userId, data),
  );
export const publishEverywhere = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./publishing.server")).runPublication(context.userId, data.id),
  );
export const removePortfolioStory = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./publishing.server")).unpublishPortfolio(context.userId, data.id),
  );
export const readPortfolioStory = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => (await import("./publishing.server")).publicPortfolio(data.id));
export const readPublicPortfolio = createServerFn({ method: "GET" })
  .inputValidator(z.object({ owner: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    (await import("./publishing.server")).publicPortfolioIndex(data.owner),
  );
