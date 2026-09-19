import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount as requireSupabaseAuth } from "./auth.functions";

const auth: [typeof businessAuth, typeof requireSupabaseAuth] = [businessAuth, requireSupabaseAuth];

export const listScheduledPosts = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => (await import("./schedule.server")).listSchedule(context.userId));

export const createScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(
    z
      .object({
        caption: z.string().min(1).max(2200),
        networks: z.array(z.string()).min(1).max(12),
        runAt: z.string().min(10).max(40),
        secrets: z.array(z.unknown()).max(12).optional(),
        image: z
          .object({
            mime: z.string().max(40),
            data: z.string().max(2_100_000),
          })
          .optional(),
      })
      .strict(),
  )
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).createSchedule(context.userId, data),
  );

export const cancelScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).cancelSchedule(context.userId, data.id),
  );

export const runScheduledPost = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) =>
    (await import("./schedule.server")).runSchedule(context.userId, data.id),
  );
