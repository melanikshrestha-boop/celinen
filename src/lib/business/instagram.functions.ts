/** Instagram server functions. The owner is always the verified session user:
 * no function accepts an owner, account or token from the page.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount } from "./auth.functions";
import { instagramPostInput } from "../social/instagram-post";
import { commentAction, graphCursor, graphId } from "../social/instagram-manage";

const auth: [typeof businessAuth, typeof verifiedBusinessAccount] = [
  businessAuth,
  verifiedBusinessAccount,
];

async function manageDeps() {
  const ig = await import("./instagram.server");
  return { fetch, session: (owner: string) => ig.instagramSession(owner) };
}

export const instagramAccount = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => {
    const ig = await import("./instagram.server");
    const configured = ig.instagramConfigured();
    // Names only, so the card can say which Worker secret is absent.
    const { missing } = (await import("./social-connections.server")).connectorConfigured(
      "instagram",
    );
    const row = await ig.instagramConnection(context.userId);
    const posts = await (
      await import("./instagram-post.server")
    )
      .listInstagramPosts(context.userId)
      .catch(() => []);
    return {
      configured,
      missing,
      connection: row
        ? {
            username: row.username,
            accountType: row.account_type ?? null,
            expiresAt: row.expires_at,
            active: Date.parse(row.expires_at) > Date.now() + 60000,
            scopes: ig.connectionScopes(row),
          }
        : null,
      posts,
    };
  });

export const startInstagramConnection = createServerFn({ method: "POST" })
  .middleware(auth)
  .handler(async ({ context }) =>
    (await import("./instagram.server")).startInstagram(context.userId),
  );

export const finishInstagramConnection = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(
    z
      .object({ code: z.string().min(1).max(4000), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict(),
  )
  .handler(async ({ context, data }) =>
    (await import("./instagram.server")).finishInstagram(context.userId, data.code, data.state),
  );

export const createInstagramPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(instagramPostInput)
  .handler(async ({ context, data }) =>
    (await import("./instagram-post.server")).createInstagramPost(context.userId, data),
  );

export const advanceInstagramPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./instagram-post.server")).advanceInstagramPost(context.userId, data.id),
  );

export const discardInstagramPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./instagram-post.server")).discardInstagramPost(context.userId, data.id),
  );

export const instagramMedia = createServerFn({ method: "GET" })
  .middleware(auth)
  .validator(z.object({ after: graphCursor.nullable() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./instagram-manage.server")).listInstagramMedia(
      context.userId,
      data.after,
      await manageDeps(),
    ),
  );

export const instagramComments = createServerFn({ method: "GET" })
  .middleware(auth)
  .validator(z.object({ mediaId: graphId, after: graphCursor.nullable() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./instagram-manage.server")).listInstagramComments(
      context.userId,
      data.mediaId,
      data.after,
      await manageDeps(),
    ),
  );

export const instagramCommentAction = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(commentAction)
  .handler(async ({ context, data }) =>
    (await import("./instagram-manage.server")).actOnInstagramComment(
      context.userId,
      data,
      await manageDeps(),
    ),
  );

export const instagramInsights = createServerFn({ method: "GET" })
  .middleware(auth)
  .validator(z.object({ mediaId: graphId }).strict())
  .handler(async ({ context, data }) =>
    (await import("./instagram-manage.server")).instagramMediaInsights(
      context.userId,
      data.mediaId,
      await manageDeps(),
    ),
  );
