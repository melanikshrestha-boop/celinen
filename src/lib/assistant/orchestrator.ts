import { LENSLAB_PERSONALITY } from "./personality";
import { classifyAssistantIntent } from "./intent";
import { formatKnowledgeForPrompt, retrievePhotographyKnowledge } from "./knowledge";
import { defaultAssistantMemory, formatMemoryForPrompt, type AssistantMemory } from "./memory";
import { formatToolsForPrompt } from "./tools";
import { LENSLAB_TASTE } from "./taste";
import { loadLiveSportsBrief, sportsEventSystemPrompt, wantsEventSearch } from "../photographer-events";
import { isPhotographerWorkRole } from "../photographer-work-roles";

export type ChatTurn = { role: string; content: string };

export async function assembleAssistantMessages(input: {
  messages: unknown[];
  workRole?: unknown;
  memory?: AssistantMemory;
  now?: Date;
  loadLive?: typeof loadLiveSportsBrief;
}): Promise<ChatTurn[]> {
  const lastUser = [...input.messages].reverse().find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return (item as { role?: unknown }).role === "user";
  }) as { content?: unknown } | undefined;
  const ask = typeof lastUser?.content === "string" ? lastUser.content : "";
  const role =
    typeof input.workRole === "string" && isPhotographerWorkRole(input.workRole)
      ? input.workRole
      : "sports";
  const intent = ask ? classifyAssistantIntent(ask) : "knowledge";
  const memory = input.memory ?? defaultAssistantMemory("session", role);
  const extra: ChatTurn[] = [];

  extra.push({
    role: "system",
    content: `INTENT ${intent}. TASTE sports.peak_action=${LENSLAB_TASTE.sports.peak_action}; portrait.expression=${LENSLAB_TASTE.portrait.expression}; motion_energy=${LENSLAB_TASTE.aesthetic_profile.motion_energy}.`,
  });
  extra.push({ role: "system", content: formatMemoryForPrompt({ ...memory, user: { ...memory.user, workRole: role } }) });
  extra.push({ role: "system", content: formatToolsForPrompt() });

  if (intent === "knowledge" || intent === "diagnostic") {
    const docs = retrievePhotographyKnowledge(ask);
    const block = formatKnowledgeForPrompt(docs);
    if (block) extra.push({ role: "system", content: `PHOTOGRAPHY KNOWLEDGE\n${block}` });
  }

  const loadLive = input.loadLive ?? loadLiveSportsBrief;
  if (intent === "research" || wantsEventSearch(ask)) {
    const live = await loadLive();
    extra.push({
      role: "system",
      content: sportsEventSystemPrompt(role, live, (input.now ?? new Date()).toISOString()),
    });
  }

  const rest = input.messages.filter(
    (item): item is ChatTurn =>
      !!item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as ChatTurn).role === "string" &&
      typeof (item as ChatTurn).content === "string",
  );

  return [{ role: "system", content: LENSLAB_PERSONALITY }, ...extra, ...rest];
}
