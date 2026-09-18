/** Story broadcast server functions. The owner is always the verified session
 * user: no function accepts an owner, account, Page or token from the page.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount } from "./auth.functions";
import { storyBroadcastInput } from "../social/story-broadcast";

const auth: [typeof businessAuth, typeof verifiedBusinessAccount] = [
  businessAuth,
  verifiedBusinessAccount,
];
const byId = z.object({ id: z.string().uuid() }).strict();

/** What the composer needs before it offers destinations: which accounts are
 * connected, and whether each can publish a story right now. */
export const storyDestinations = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => {
    const [ig, fb] = await Promise.all([import("./instagram.server"), import("./facebook.server")]);
    const instagram = ig.instagramConfigured()
      ? await ig.instagramConnection(context.userId).catch(() => null)
      : null;
    const facebook = await fb.facebookStatus(context.userId).catch(() => null);
    const page = facebook?.pages.find((page) => page.id === facebook.selected) ?? null;
    return {
      instagram: instagram
        ? {
            configured: true,
            name: `@${instagram.username}`,
            ready:
              Date.parse(instagram.expires_at) > Date.now() + 60000 &&
              ig.connectionScopes(instagram).includes("instagram_business_content_publish"),
          }
        : { configured: ig.instagramConfigured(), name: "", ready: false },
      facebook: {
        configured: facebook?.configured ?? false,
        name: page?.name ?? "",
        ready: Boolean(facebook?.active && page),
      },
    };
  });

/** The Facebook card in Social accounts: the Pages this owner granted, and
 * which one stories go to. Page access tokens never leave the server. */
export const facebookAccount = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => {
    const status = await (await import("./facebook.server")).facebookStatus(context.userId);
    return {
      configured: status.configured,
      active: status.active,
      pages: status.pages,
      selected: status.selected,
      selectedName: status.pages.find((page) => page.id === status.selected)?.name ?? "",
    };
  });

export const createStoryBroadcast = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(storyBroadcastInput)
  .handler(async ({ context, data }) =>
    (await import("./story-broadcast.server")).createStoryBroadcast(context.userId, data),
  );

export const advanceStoryBroadcast = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(byId)
  .handler(async ({ context, data }) =>
    (await import("./story-broadcast.server")).advanceStoryBroadcast(context.userId, data.id),
  );

export const reconcileStoryBroadcast = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(byId)
  .handler(async ({ context, data }) =>
    (await import("./story-broadcast.server")).reconcileStoryBroadcast(context.userId, data.id),
  );

export const discardStoryBroadcast = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(byId)
  .handler(async ({ context, data }) =>
    (await import("./story-broadcast.server")).discardStoryBroadcast(context.userId, data.id),
  );

export const listStoryBroadcasts = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) =>
    (await import("./story-broadcast.server")).listStoryBroadcasts(context.userId).catch(() => []),
  );
