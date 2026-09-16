import { studioCommandRefusal } from "./studio/command-safety";
import { LENSLAB_PERSONALITY } from "./assistant/personality";

/** Conversation is not authorization to execute a fragment of a sentence. */
export function isPhotographyConversation(input: string): boolean {
  const text = input.trim().replace(/[’‘]/g, "'");
  if (studioCommandRefusal(text)) return true;
  if (
    /^(?:please\s+)?write\s+(?:(?:the|my)\s+)?(?:xmp|sidecars?|(?:to\s+)?lightroom)[.!]?$/i.test(
      text,
    )
  )
    return false;
  if (/^(?:review|compare|show)(?: my| the)? (?:bursts|similar frames)[.!]?$/i.test(text))
    return false;
  if (
    /^(?:(?:hi|hello|hey|thanks|thank you)\b|(?:what|why|where|when|who|which|how|should|could|would|can|is|are|do|does)\b|(?:please\s+)?(?:brainstorm|plan|suggest|recommend|explain|discuss|describe|compare|draft|write|research|find|book|reserve)\b|(?:help me|tell me|let's|lets|i want|i need|i'm|i am|we want|we need)\b)/i.test(
      text,
    )
  )
    return true;
  // Lyrics, other-language hellos, half-lines: chat, not a studio command.
  if (/[^\x00-\x7F]/.test(text) || /[,']/.test(text) || /\b(lyric|lyrics|song|verse|chorus|come with)\b/i.test(text))
    return true;
  return false;
}

export const PHOTOGRAPHY_ASSISTANT_POLICY = LENSLAB_PERSONALITY;

export function assistantUnavailable(reason: "local" | "disabled" | "session"): string {
  if (reason === "local")
    return "This local lab only runs photo commands; its conversational AI is not connected. Open the signed-in hosted workspace for brainstorming and planning. Your photos have not been changed.";
  if (reason === "disabled")
    return "Cloud assistant is turned off in your account settings. Turn it on to chat about ideas and plans. Local photo commands still work; this message was not sent to an AI provider.";
  return "I couldn't verify your sign-in for the conversational assistant. Sign in again, then resend your message. Your photos have not been changed.";
}

export function requireAssistantMessage(value: unknown): {
  content?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: unknown; arguments?: string } }>;
} {
  if (!value || typeof value !== "object")
    throw new Error("The assistant returned no reply. Please try again.");
  const message = value as {
    content?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: unknown; arguments?: string } }>;
  };
  if (
    !(typeof message.content === "string" && message.content.trim()) &&
    !(Array.isArray(message.tool_calls) && message.tool_calls.length)
  )
    throw new Error("The assistant returned no reply. Please try again.");
  return message;
}
