import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatSchema, storedMessages, type ChatRecord, type ChatSummary } from "./chat-history";

const ownerSchema = z.string().uuid();
function requireOwner(expectedOwner: string, actual: string) {
  if (expectedOwner !== actual)
    throw new Error("Your account changed. Reopen this workspace before saving.");
}

// This additive table is deliberately separate from shared client conversations.
export const listWorkspaceChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ expectedOwner: ownerSchema, project: z.string().min(1).max(300) }).strict(),
  )
  .handler(async ({ data, context }): Promise<ChatSummary[]> => {
    requireOwner(data.expectedOwner, context.userId);
    const { data: rows, error } = await (context.supabase as SupabaseClient)
      .from("workspace_chats")
      .select(
        "record->id,record->project,record->title,record->named,record->archived,record->pinned,record->section,record->unread,record->revision,record->createdAt,record->updatedAt",
      )
      .eq("owner_id", context.userId)
      .eq("project", data.project)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error)
      throw new Error(
        "Cloud chat history is unavailable. Check the chat-history migration and try again.",
      );
    return (rows ?? []).map((row) => {
      const parsed = chatSchema.parse({
        ...row,
        pinned: row.pinned ?? false,
        section: row.section ?? "",
        unread: row.unread ?? false,
        messages: [],
        draft: "",
      });
      const { messages: _messages, draft: _draft, ...summary } = parsed;
      return summary;
    });
  });

export const deleteWorkspaceChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        expectedOwner: ownerSchema,
        id: z.string().uuid(),
        project: z.string().min(1).max(300),
        revision: z.number().int().min(1),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    requireOwner(data.expectedOwner, context.userId);
    const { data: removed, error } = await (context.supabase as SupabaseClient).rpc(
      "delete_workspace_chat",
      { chat_id: data.id, expected_project: data.project, expected_revision: data.revision },
    );
    if (error || removed !== true)
      throw new Error(
        "Chat could not be deleted or changed in another tab. Reload before trying again.",
      );
    return { deleted: true };
  });
export const readWorkspaceChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ expectedOwner: ownerSchema, id: z.string().uuid() }).strict())
  .handler(async ({ data, context }): Promise<ChatRecord> => {
    requireOwner(data.expectedOwner, context.userId);
    const { data: row, error } = await (context.supabase as SupabaseClient)
      .from("workspace_chats")
      .select("record")
      .eq("owner_id", context.userId)
      .eq("id", data.id)
      .single();
    if (error) throw new Error("This chat is unavailable for your account.");
    return chatSchema.parse(row.record);
  });
export const saveWorkspaceChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ expectedOwner: ownerSchema, record: chatSchema }).strict())
  .handler(async ({ data, context }): Promise<ChatRecord> => {
    requireOwner(data.expectedOwner, context.userId);
    const { data: saved, error } = await (context.supabase as SupabaseClient).rpc(
      "save_workspace_chat",
      { incoming: { ...data.record, draft: "", messages: storedMessages(data.record.messages) } },
    );
    if (error)
      throw new Error(
        error.code === "40001"
          ? "This chat changed in another tab. Export this conversation before reloading."
          : "Your chat could not be saved to your account. Keep this tab open and retry.",
      );
    return chatSchema.parse(saved);
  });
