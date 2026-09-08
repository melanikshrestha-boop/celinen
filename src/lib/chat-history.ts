import { z } from "zod";
import { workspaceStorageKey } from "./workspace-storage";

export const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(32_000),
    privateConnector: z.boolean().optional(),
    tools: z
      .array(z.object({ name: z.string().max(120), result: z.string().max(32_000) }).strict())
      .max(40)
      .optional(),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatSchema = z
  .object({
    id: z.string().uuid(),
    project: z.string().min(1).max(300),
    title: z.string().trim().min(1).max(80),
    named: z.boolean(),
    archived: z.boolean(),
    pinned: z.boolean().default(false),
    section: z.string().trim().max(60).default(""),
    unread: z.boolean().default(false),
    revision: z.number().int().min(0),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    messages: z.array(chatMessageSchema).max(500),
    draft: z.string().max(32_000),
  })
  .strict()
  .refine(
    (record) => JSON.stringify(record).length <= 512_000,
    "This conversation is full. Export it and start a new chat.",
  );
export type ChatRecord = z.infer<typeof chatSchema>;
export type ChatSummary = Omit<ChatRecord, "messages" | "draft">;
export function needsChatSave(
  local: boolean,
  messagesChanged: boolean,
  revision: number,
  metadataPending: boolean,
  draft: string,
) {
  // A cloud draft gets an empty metadata row so it stays reachable in recents,
  // but no draft text enters the request. Later keystrokes are memory-only.
  return local || messagesChanged || (revision === 0 && !metadataPending && !!draft.trim());
}
export const CHAT_CONFLICT =
  "This chat changed in another tab. Export this tab's conversation before reloading. Your photos are untouched.";
export function newChat(project: string, title = "New chat"): ChatRecord {
  return {
    id: crypto.randomUUID(),
    project,
    title,
    named: title !== "New chat",
    archived: false,
    pinned: false,
    section: "",
    unread: false,
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    draft: "",
  };
}
export function storedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.privateConnector
      ? {
          role: message.role,
          text:
            message.role === "user"
              ? "Opened a private connection tab"
              : "Connection request opened separately. Search terms and mailbox content are not saved in this chat.",
          privateConnector: true,
        }
      : chatMessageSchema.parse(message),
  );
}
export function transcriptContext(messages: ChatMessage[]) {
  // Historical receipts only, never tool calls or commands to replay. Connector text never enters the planner.
  return storedMessages(messages)
    .filter((message) => !message.privateConnector)
    .slice(-40)
    .map((message) => ({ role: message.role, content: message.text }));
}
export function chatTitle(messages: ChatMessage[]) {
  return (
    messages
      .find((message) => message.role === "user" && !message.privateConnector)
      ?.text.replace(/\s+/g, " ")
      .slice(0, 64) || "New chat"
  );
}
export interface ChatRepository {
  list(project: string): Promise<ChatSummary[]>;
  read(id: string): Promise<ChatRecord>;
  save(record: ChatRecord): Promise<ChatRecord>;
  remove(id: string, project: string, revision: number): Promise<void>;
}
export function localChatRepository(
  scope: string,
  factory: IDBFactory = indexedDB,
): ChatRepository {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(workspaceStorageKey("lenslabs.chat-history.v1", scope), 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("chats", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Chat storage could not open."));
    request.onblocked = () => reject(new Error("Close older LensLabs tabs to open chat storage."));
  });
  return {
    async remove(id, project, revision) {
      const db = await database;
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("chats", "readwrite");
        const store = tx.objectStore("chats");
        const request = store.get(id);
        let conflict = false;
        request.onsuccess = () => {
          if (
            !request.result ||
            request.result.project !== project ||
            request.result.revision !== revision
          ) {
            conflict = true;
            tx.abort();
          } else store.delete(id);
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(
            new Error(conflict ? CHAT_CONFLICT : "Chat could not be deleted. Nothing was removed."),
          );
      });
    },
    async list(project) {
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("chats", "readonly");
        const request = tx.objectStore("chats").getAll();
        tx.oncomplete = () => {
          try {
            resolve(
              request.result
                .map((row) => chatSchema.parse(row))
                .filter((row) => row.project === project)
                .map(({ messages: _messages, draft: _draft, ...row }) => row)
                .sort((a, b) => b.updatedAt - a.updatedAt),
            );
          } catch {
            reject(new Error("Saved chats could not be read. They have not been changed."));
          }
        };
        tx.onabort = () => reject(tx.error ?? new Error("Chats could not be loaded."));
      });
    },
    async read(id) {
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("chats", "readonly");
        const request = tx.objectStore("chats").get(id);
        tx.oncomplete = () => {
          try {
            resolve(chatSchema.parse(request.result));
          } catch {
            reject(new Error("That chat could not be restored. Stored history was not changed."));
          }
        };
        tx.onabort = () => reject(tx.error ?? new Error("Chat could not be loaded."));
      });
    },
    async save(input) {
      const record = chatSchema.parse({ ...input, messages: storedMessages(input.messages) });
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("chats", "readwrite");
        const store = tx.objectStore("chats");
        const read = store.get(record.id);
        let next: ChatRecord | undefined;
        let failure: Error | undefined;
        read.onsuccess = () => {
          if (
            (read.result?.revision ?? 0) !== record.revision ||
            (read.result && read.result.project !== record.project)
          ) {
            failure = new Error(CHAT_CONFLICT);
            tx.abort();
            return;
          }
          next = { ...record, revision: record.revision + 1 };
          store.put(next);
        };
        tx.oncomplete = () => (next ? resolve(next) : reject(new Error("Chat wasn't saved.")));
        tx.onabort = () =>
          reject(
            failure ??
              tx.error ??
              new Error(
                "Chat storage is full or unavailable. Export your conversation before leaving.",
              ),
          );
      });
    },
  };
}
