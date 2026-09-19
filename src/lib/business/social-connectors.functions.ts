/** Social connector server functions: connect, finish, disconnect and status
 * for every provider. The owner is always the verified session user: no
 * function accepts an owner, account or token from the page, and no token is
 * ever returned to it. Scheduling lives in schedule.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount } from "./auth.functions";
import { SOCIAL_PROVIDERS } from "../social/connectors";

const auth: [typeof businessAuth, typeof verifiedBusinessAccount] = [
  businessAuth,
  verifiedBusinessAccount,
];
const provider = z.enum(SOCIAL_PROVIDERS);

/** Per provider: configured (and if not, exactly which secret is missing), and the
 * connection with its plain-English state. */
export const socialConnectors = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) =>
    (await import("./social-connections.server")).connectorStatus(context.userId),
  );

export const startSocialConnector = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ provider }).strict())
  .handler(async ({ context, data }) =>
    (await import("./social-connections.server")).startSocialConnection(
      context.userId,
      data.provider,
    ),
  );

export const finishSocialConnector = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(
    z
      .object({
        provider,
        code: z.string().min(1).max(4000),
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict(),
  )
  .handler(async ({ context, data }) =>
    (await import("./social-connections.server")).finishSocialConnection(
      context.userId,
      data.provider,
      data.code,
      data.state,
    ),
  );

export const disconnectSocialConnector = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ provider }).strict())
  .handler(async ({ context, data }) =>
    (await import("./social-connections.server")).disconnectSocialConnection(
      context.userId,
      data.provider,
    ),
  );
