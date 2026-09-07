// Isolated in-memory IndexedDB. Never touches a user's browser or saved shoot.
import { expect } from "bun:test";
import { localChatRepository, newChat, CHAT_CONFLICT } from "../src/lib/chat-history";
const runtime = process.argv[2];
if (!runtime?.startsWith("/")) throw new Error("Pass the absolute fake-indexeddb module path.");
const { IDBFactory } = await import(runtime);
const factory = new IDBFactory();
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const repo = localChatRepository(a, factory),
  otherTab = localChatRepository(a, factory),
  otherAccount = localChatRepository(b, factory);
const record = newChat("shoot-a");
record.messages = [{ role: "user", text: "Warm this photo" }];
record.draft = "Draft kept across reload";
const first = await repo.save(record);
expect(first.revision).toBe(1);
expect((await otherTab.read(first.id)).draft).toBe(record.draft);
expect(await otherAccount.list("shoot-a")).toEqual([]);
expect(await repo.list("shoot-b")).toEqual([]);
await expect(otherAccount.read(first.id)).rejects.toThrow();
const second = await otherTab.save({ ...first, title: "Renamed", named: true });
await expect(repo.save({ ...first, draft: "stale text" })).rejects.toThrow(CHAT_CONFLICT);
expect((await repo.read(first.id)).title).toBe("Renamed");
await expect(repo.save({ ...second, project: "another-shoot" })).rejects.toThrow(CHAT_CONFLICT);
const archived = await repo.save({ ...second, archived: true });
expect((await repo.list("shoot-a"))[0]?.archived).toBe(true);
expect((await repo.read(first.id)).messages).toEqual(record.messages);
const restored = await repo.save({ ...archived, archived: false });
expect(restored.revision).toBe(4);
const privateChat = newChat("shoot-a");
privateChat.messages = [{ role: "user", text: "Gmail confidential query", privateConnector: true }];
await repo.save(privateChat);
expect(JSON.stringify(await repo.read(privateChat.id))).not.toContain("confidential");
const racing = newChat("shoot-a");
const results = await Promise.allSettled([repo.save(racing), otherTab.save(racing)]);
expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
console.log(
  "Chat IndexedDB: 15 assertions passed: reload, draft, account isolation, project isolation, rename, archive/restore, privacy, stale writers, concurrent creation.",
);
