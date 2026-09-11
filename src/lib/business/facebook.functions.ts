import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount } from "./auth.functions";
const auth: [typeof businessAuth, typeof verifiedBusinessAccount] = [
  businessAuth,
  verifiedBusinessAccount,
];
export const connectFacebook = createServerFn({ method: "POST" })
  .middleware(auth)
  .handler(async ({ context }) =>
    (await import("./facebook.server")).startFacebook(context.userId),
  );
export const completeFacebook = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(
    z
      .object({ code: z.string().min(1).max(4000), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict(),
  )
  .handler(async ({ context, data }) =>
    (await import("./facebook.server")).finishFacebook(context.userId, data.code, data.state),
  );
export const chooseFacebookPage = createServerFn({ method: "POST" })
  .middleware(auth)
  .validator(z.object({ id: z.string().regex(/^\d+$/) }).strict())
  .handler(async ({ context, data }) =>
    (await import("./facebook.server")).selectFacebookPage(context.userId, data.id),
  );
export const disconnectFacebook = createServerFn({ method: "POST" })
  .middleware(auth)
  .handler(async ({ context }) =>
    (await import("./facebook.server")).disconnectFacebook(context.userId),
  );
