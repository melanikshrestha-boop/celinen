import { assistantUnavailable, requireAssistantMessage } from "./photography-assistant";
import { isLocalSingleUserMode } from "./app-mode";

type Message = { role: "user" | "assistant"; text: string };
type Session = { user: { id: string }; access_token: string } | null;
type Dependencies = {
  session: () => Promise<Session>;
  fetch: typeof fetch;
  local: boolean;
};

/** The dashboard uses the same authenticated server as Studio, without action tools. */
export async function requestDashboardReply(
  input: { scope: string; messages: Message[]; enabled: boolean; signal: AbortSignal },
  dependencies: Dependencies = {
    local: isLocalSingleUserMode,
    fetch: (...args) => fetch(...args),
    session: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(assistantUnavailable("session"));
      return data.session;
    },
  },
): Promise<string> {
  if (dependencies.local) throw new Error(assistantUnavailable("local"));
  if (!input.enabled) throw new Error(assistantUnavailable("disabled"));
  input.signal.throwIfAborted();
  const session = await dependencies.session();
  input.signal.throwIfAborted();
  if (!session || session.user.id !== input.scope) throw new Error(assistantUnavailable("session"));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 30_000);
  try {
    const response = await dependencies.fetch("/api/chat", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        mode: "conversation",
        messages: input.messages.slice(-40).map(({ role, text }) => ({ role, content: text })),
      }),
    });
    if (response.status === 401 || response.status === 403)
      throw new Error(assistantUnavailable("session"));
    if (!(response.headers.get("content-type") ?? "").includes("application/json"))
      throw new Error(
        `The chat service returned an unexpected response (${response.status}). Your message remains in this chat.`,
      );
    const data = (await response.json()) as { error?: unknown; message?: unknown };
    if (!response.ok || data.error) {
      if (response.status === 402)
        throw new Error(
          "The assistant's AI credits need replenishing. Your message remains in this chat.",
        );
      if (response.status === 429)
        throw new Error("The assistant is busy. Wait a moment, then try again.");
      throw new Error(
        `The chat service is unavailable (${response.status}). Your message remains in this chat.`,
      );
    }
    input.signal.throwIfAborted();
    controller.signal.throwIfAborted();
    const message = requireAssistantMessage(data.message);
    if (message.tool_calls?.length)
      throw new Error("The assistant proposed an unsupported action. Nothing was run.");
    return message.content!.trim();
  } catch (error) {
    if (controller.signal.aborted && !input.signal.aborted)
      throw new Error(
        "The assistant took too long to reply. Your message remains in this chat; please try again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", cancel);
  }
}
