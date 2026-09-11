import type { ChatSummary } from "@/lib/chat-history";

/** UI vocabulary only: never rewrite persisted or user-authored conversation titles. */
export function sidebarConversationTitle(row: Pick<ChatSummary, "title" | "named">): string {
  return !row.named && row.title === "New chat" ? "New Shoot" : row.title;
}

export function showRecentSection(rowCount: number): boolean {
  return Number.isInteger(rowCount) && rowCount > 2;
}

/** The history model still calls these chats; its visible navigation calls them shoots. */
export function historyKindLabel(kind: "chat" | "shoot" | "album"): string {
  return kind === "album" ? "Album" : "Shoot";
}
