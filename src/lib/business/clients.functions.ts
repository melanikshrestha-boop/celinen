import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { businessAuth, verifiedBusinessAccount as requireSupabaseAuth } from "./auth.functions";
import { isClientWorkspace, emptyClientWorkspace, type ClientWorkspace } from "../client-workspace";

export const readBusinessClients = createServerFn({ method: "GET" })
  .middleware([businessAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = (await import("./database.server")).businessDatabase();
    const { data, error } = await db
      .from("business_clients")
      .select("state")
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error)
      throw new Error(
        "Client sync is unavailable. Apply the business workspace migration before saving cloud records.",
      );
    const state = data?.state ?? emptyClientWorkspace();
    if (!isClientWorkspace(state))
      throw new Error("Client records need recovery. Nothing was replaced.");
    return state;
  });
export const saveBusinessClients = createServerFn({ method: "POST" })
  .middleware([businessAuth, requireSupabaseAuth])
  .inputValidator(
    z
      .custom<ClientWorkspace>(isClientWorkspace)
      .refine(
        (s) => s.clients.length <= 10000 && JSON.stringify(s).length <= 4_000_000,
        "Client workspace is too large.",
      ),
  )
  .handler(async ({ context, data }) => {
    const db = (await import("./database.server")).businessDatabase();
    const { data: saved, error } = await db.rpc("business_save_clients", {
      p_owner: context.userId,
      p_state: data,
      p_revision: data.revision,
    });
    if (error || !isClientWorkspace(saved))
      throw new Error(
        "Clients changed elsewhere or could not be saved. Refresh before editing again; your form is preserved.",
      );
    return saved;
  });
