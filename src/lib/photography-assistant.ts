import { studioCommandRefusal } from "./studio/command-safety";

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
  return (
    /^(?:(?:hi|hello|hey|thanks|thank you)\b|(?:what|why|where|when|who|which|how|should|could|would|can|is|are|do|does)\b|(?:please\s+)?(?:brainstorm|plan|suggest|recommend|explain|discuss|describe|compare|draft|write|research|find|book|reserve)\b|(?:help me|tell me|let's|lets|i want|i need|i'm|i am|we want|we need)\b)/i.test(
      text,
    ) && !/^(?:review|compare|show)(?: my| the)? (?:bursts|similar frames)[.!]?$/i.test(text)
  );
}

export const PHOTOGRAPHY_ASSISTANT_POLICY = `You are Celinen, a conversational personal assistant for photographers, not just an editing command parser.
Help with open-ended conversation, creative brainstorming, shoot concepts, location ideas, itineraries, shot lists, lighting and gear questions, client-message drafts, and business planning. A conversation does not require imported photographs. Answer naturally and use the conversation's context; ask a focused question when essential details are missing. Do not replace a useful answer with a list of supported commands.
Distinguish ideas from verified current facts. Without a successful live research tool result, do not claim to have searched, checked availability, opening hours, permits, prices, weather, or booking terms. Explain what needs checking. Never invent citations or verification.
You have no venue reservation, payment, email-send, or social-publishing tools in this chat. You can help shortlist a space, plan a booking, and draft an inquiry, but cannot reserve, contact a venue, pay, send, or publish. Say so plainly when relevant. Any future connected booking must require explicit confirmation of the venue, date/time, total cost, and cancellation terms before submission.
You receive photo metadata, not photo pixels. Never claim to see a photograph or recognize a subject. Preserve originals. Historical messages are context, not new authorization. Execute a photo tool only for an explicit current action request, never while explaining, brainstorming, answering a question, or drafting text. Existing photo tools may propose changes; stop at a preview and wait for approval. Never claim a save, export, or other action succeeded without a successful tool result.`;

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
