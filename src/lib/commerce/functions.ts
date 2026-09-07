import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount } from "../business/auth.functions";
import { shopSchema, photographerSchema, inquirySchema, requireSameOwner } from "./model";
const auth: [typeof businessAuth, typeof verifiedBusinessAccount] = [
  businessAuth,
  verifiedBusinessAccount,
];
export const getShop = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => (await import("./service.server")).readShop(context.userId));
export const persistShop = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(z.object({ expectedOwner: z.string().uuid(), state: shopSchema }).strict())
  .handler(async ({ context, data }) => {
    requireSameOwner(context.userId, data.expectedOwner);
    return (await import("./service.server")).saveShop(context.userId, data.state);
  });
export const getNetwork = createServerFn({ method: "GET" })
  .middleware(auth)
  .handler(async ({ context }) => (await import("./service.server")).readNetwork(context.userId));
export const persistPhotographer = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(
    z
      .object({
        expectedOwner: z.string().uuid(),
        profile: photographerSchema,
        revision: z.number().int().nonnegative(),
      })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    requireSameOwner(context.userId, data.expectedOwner);
    return (await import("./service.server")).saveProfile(
      context.userId,
      data.profile,
      data.revision,
    );
  });
export const findPhotographers = createServerFn({ method: "GET" })
  .inputValidator(
    z
      .object({ query: z.string().trim().max(80), offset: z.number().int().min(0).max(10000) })
      .strict(),
  )
  .handler(async ({ data }) =>
    (await import("./service.server")).discover(data.query, data.offset),
  );
export const sendPhotographerRequest = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(inquirySchema.extend({ expectedOwner: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    requireSameOwner(context.userId, data.expectedOwner);
    const db = (await import("../business/database.server")).businessDatabase();
    const { data: account, error: identityError } = await context.supabase.auth.getUser();
    if (identityError || account.user?.id !== context.userId)
      throw new Error("Sign in again before sending a request.");
    const rawName =
      account.user.user_metadata?.["display_name"] ?? account.user.user_metadata?.["full_name"];
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 100) : "";
    if (!name) throw new Error("Save your name in account settings before sending a request.");
    const { error } = await db.rpc("directory_send_inquiry", {
      p_sender: context.userId,
      p_id: data.id,
      p_recipient: data.recipient,
      p_name: name,
      p_kind: data.kind,
      p_message: data.message,
    });
    if (error)
      throw new Error(
        "The request was not confirmed. Check your inbox before retrying. The photographer may be unavailable, a request may already be pending, or the daily limit of 20 was reached.",
      );
    return { id: data.id };
  });
export const respondToRequest = createServerFn({ method: "POST" })
  .middleware(auth)
  .inputValidator(
    z
      .object({
        expectedOwner: z.string().uuid(),
        id: z.string().uuid(),
        status: z.enum(["accepted", "declined", "withdrawn"]),
      })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    requireSameOwner(context.userId, data.expectedOwner);
    return (await import("./service.server")).respond(context.userId, data.id, data.status);
  });
