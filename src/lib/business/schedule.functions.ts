import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount as requireSupabaseAuth } from "./auth.functions";
import { mediaItem, unitOptions } from "../social/connectors";

const auth: [typeof businessAuth, typeof requireSupabaseAuth] = [businessAuth, requireSupabaseAuth];

export const listScheduledPosts = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => (await import("./schedule.server")).listSchedule(context.userId));

export const createScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(
    z
      .object({
        caption: z.string().max(20000),
        networks: z.array(z.string()).min(1).max(12),
        runAt: z.string().min(10).max(40),
        secrets: z.array(z.unknown()).max(12).optional(),
        /** One inline JPEG (the composer's attach button). */
        image: z
          .object({
            mime: z.string().max(40),
            data: z.string().max(2_100_000),
          })
          .optional(),
        /** Chosen by the page once per post; the same id never schedules twice. */
        id: z.string().uuid().optional(),
        unitKind: z.enum(["post", "story", "reel", "video"]).optional(),
        title: z.string().max(400).optional(),
        /** Declared photos/videos, uploaded afterwards through the returned tickets. */
        media: z.array(mediaItem).max(20).optional(),
        options: unitOptions.optional(),
      })
      .strict(),
  )
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).createSchedule(context.userId, data),
  );

/** After every upload ticket succeeded: the post becomes runnable. */
export const readyScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).readySchedule(context.userId, data.id),
  );

export const cancelScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).cancelSchedule(context.userId, data.id),
  );

export const rescheduleScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid(), runAt: z.string().min(10).max(40) }).strict())
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).rescheduleSchedule(context.userId, data.id, data.runAt),
  );

/** One bounded step for one of the caller's posts (post now, check again). */
export const runScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).runSchedule(context.userId, data.id),
  );

/** Runs whatever of the caller's is due, within one request budget. */
export const runDueScheduledPosts = createServerFn({ method: "POST" })
  .middleware(auth)
  .handler(async ({ context }) => {
    const { tickDuePosts, RUN_BUDGET_MS } = await import("./schedule.server");
    return tickDuePosts(Date.now(), undefined, { owner: context.userId, budgetMs: RUN_BUDGET_MS });
  });
