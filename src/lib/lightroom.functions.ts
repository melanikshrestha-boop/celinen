import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface BridgeCredentials {
  workspace: string;
  token: string;
}

/**
 * Per-studio credentials for the public Lightroom bridge.
 *
 * The bridge used to be scoped by a free-text `workspace` name alone, which let
 * anyone read or overwrite another studio's sync payload. Each account now gets
 * its own random workspace id plus a secret token that the bridge validates.
 */
export const getBridgeCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BridgeCredentials> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("lightroom_workspaces")
      .select("workspace, token")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (existing?.workspace && existing.token) {
      return { workspace: existing.workspace, token: existing.token };
    }

    const workspace = `ws-${context.userId.replace(/-/g, "").slice(0, 20)}`;
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    const { data: row, error } = await supabaseAdmin
      .from("lightroom_workspaces")
      .upsert({ workspace, user_id: context.userId, token }, { onConflict: "user_id" })
      .select("workspace, token")
      .single();

    if (error || !row?.token) throw new Error("Could not create bridge credentials");
    return { workspace: row.workspace, token: row.token };
  });
