import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commandSchema, deliveryId, newDeliveryInput } from "./workflow";

const roomInput = z.object({ id: deliveryId });
const guestInput = roomInput.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const actionFields = {
  revision: z.number().int().nonnegative(),
  operationId: deliveryId,
  command: commandSchema,
};
const mediaFields = {
  versionIds: z.array(deliveryId).min(1).max(60),
  kind: z.enum(["proof", "phone", "full"]),
};
// Private delivery requires real cloud authentication even in the otherwise local-only Studio.
const deliveryAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getSession();
  return next({
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
  });
});
// Import server-only dependencies inside handlers: credentials never enter the browser bundle.
export const checkPrivateDelivery = createServerFn({ method: "GET" }).handler(async () => {
  return (await import("./remote.server")).deliveryReadiness();
});
export const listPrivateDeliveries = createServerFn({ method: "GET" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    return (await import("./remote.server")).listRooms(context.userId);
  });
export const createPrivateDelivery = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(newDeliveryInput.extend({ ownerId: deliveryId }))
  .handler(async ({ context, data }) => {
    const { ownerId, ...input } = data;
    if (ownerId !== context.userId)
      throw new Error("Account changed. Sign in to the original account to connect this draft.");
    return (await import("./remote.server")).createRoom(context.userId, input);
  });
export const getPrivateDelivery = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(roomInput)
  .handler(async ({ context, data }) => {
    return (await import("./remote.server")).openRoom(data.id, context.userId, "");
  });
export const changePrivateDelivery = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(roomInput.extend(actionFields))
  .handler(async ({ context, data }) => {
    return (await import("./remote.server")).act(
      data.id,
      context.userId,
      "",
      data.revision,
      data.operationId,
      data.command,
    );
  });
export const createPrivateInvitation = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(roomInput.extend({ revision: z.number().int().nonnegative() }))
  .handler(async ({ context, data }) => {
    return (await import("./remote.server")).rotateInvitation(
      data.id,
      context.userId,
      data.revision,
    );
  });
export const getPrivateUploadTickets = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(roomInput.extend({ versionId: deliveryId }))
  .handler(async ({ context, data }) => {
    return (await import("./remote.server")).uploadTickets(data.id, context.userId, data.versionId);
  });
export const verifyPrivateUpload = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(roomInput.extend({ versionId: deliveryId }))
  .handler(async ({ context, data }) => {
    return (await import("./remote.server")).completeUpload(
      data.id,
      context.userId,
      data.versionId,
    );
  });
export const getOwnerDeliveryMedia = createServerFn({ method: "POST" })
  .middleware([deliveryAuth, requireSupabaseAuth])
  .inputValidator(roomInput.extend(mediaFields))
  .handler(async ({ context, data }) => {
    return (await import("./remote.server")).signedMedia(
      data.id,
      context.userId,
      "",
      data.versionIds,
      data.kind,
    );
  });
export const openClientDelivery = createServerFn({ method: "POST" })
  .inputValidator(guestInput)
  .handler(async ({ data }) => {
    return (await import("./remote.server")).openRoom(data.id, null, data.token);
  });
export const changeClientDelivery = createServerFn({ method: "POST" })
  .inputValidator(guestInput.extend(actionFields))
  .handler(async ({ data }) => {
    return (await import("./remote.server")).act(
      data.id,
      null,
      data.token,
      data.revision,
      data.operationId,
      data.command,
    );
  });
export const getClientDeliveryMedia = createServerFn({ method: "POST" })
  .inputValidator(guestInput.extend(mediaFields))
  .handler(async ({ data }) => {
    return (await import("./remote.server")).signedMedia(
      data.id,
      null,
      data.token,
      data.versionIds,
      data.kind,
    );
  });
