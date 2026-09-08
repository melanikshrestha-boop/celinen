import { describe, expect, test } from "bun:test";
import { restorableTabs, workbenchTabsKey } from "../src/lib/workbench-tabs";
import {
  accountInitials,
  accountName,
  DEFAULT_PREFERENCES,
  displayNameSchema,
  observeSession,
  preferenceKey,
  preferencesSchema,
  readPreferences,
  shouldSendMessage,
} from "../src/lib/account-preferences";
import {
  chatSchema,
  chatTitle,
  newChat,
  needsChatSave,
  storedMessages,
  transcriptContext,
} from "../src/lib/chat-history";

describe("real account identity and device preferences", () => {
  test("uses actual metadata, never the reference screenshot's identity", () => {
    expect(accountName({ full_name: "Ada Photographer" }, "ada@example.test")).toBe(
      "Ada Photographer",
    );
    expect(accountName({ display_name: "New name", full_name: "Old name" })).toBe("New name");
    expect(accountName({}, "ada@example.test")).toBe("ada");
    expect(accountName({ full_name: { admin: true } })).toBe("Your account");
    expect(accountInitials("  Celine Nova  ")).toBe("CN");
    expect(accountInitials("李明")).toBe("李");
  });
  test("bounded profile names preserve Unicode without accepting controls", () => {
    expect(displayNameSchema.parse("  José 摄影  ")).toBe("José 摄影");
    for (const value of ["", "  ", "a".repeat(81), "hi\nthere", null, {}, 42])
      expect(displayNameSchema.safeParse(value).success).toBe(false);
  });
  test("settings are bounded and restored without trusting malformed browser storage", () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences("not json")).toEqual({ ...DEFAULT_PREFERENCES, cloudAssistant: false });
    expect(readPreferences('{"theme":"pink"}')).toEqual({
      ...DEFAULT_PREFERENCES,
      cloudAssistant: false,
    });
    expect(readPreferences('{"theme":"light","reduceMotion":true}').theme).toBe("light");
    expect(preferencesSchema.safeParse({ admin: true }).success).toBe(false);
  });
  test("device preferences isolate accounts and never adopt local profile data", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(preferenceKey(a)).not.toBe(preferenceKey(b));
    expect(preferenceKey(a)).not.toBe(preferenceKey("device-local"));
    expect(() => preferenceKey("attacker")).toThrow();
  });
  test("Enter preference, Shift+Enter, Ctrl/Cmd+Enter and IME composition", () => {
    const event = {
      key: "Enter",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      isComposing: false,
    };
    expect(shouldSendMessage(event, "enter")).toBe(true);
    expect(shouldSendMessage(event, "modifier-enter")).toBe(false);
    expect(shouldSendMessage({ ...event, metaKey: true }, "modifier-enter")).toBe(true);
    expect(shouldSendMessage({ ...event, ctrlKey: true }, "modifier-enter")).toBe(true);
    for (const mode of ["enter", "modifier-enter"] as const) {
      expect(shouldSendMessage({ ...event, shiftKey: true, ctrlKey: true }, mode)).toBe(false);
      expect(shouldSendMessage({ ...event, isComposing: true, metaKey: true }, mode)).toBe(false);
      expect(shouldSendMessage({ ...event, key: "x", metaKey: true }, mode)).toBe(false);
    }
  });
});

describe("session restoration ordering", () => {
  test("newer logout wins over a late cached sign-in", async () => {
    let event!: (value: string | null) => void, restore!: (value: string | null) => void;
    const values: (string | null)[] = [];
    const stop = observeSession<string | null>(
      (receive) => {
        event = receive;
        return () => {};
      },
      () =>
        new Promise((resolve) => {
          restore = resolve;
        }),
      (value) => values.push(value),
      () => {},
    );
    event(null);
    restore("old-user");
    await Promise.resolve();
    expect(values).toEqual([null]);
    stop();
  });
  test("new login cannot be overwritten by a failed initial restore", async () => {
    let event!: (value: string | null) => void, reject!: (error: Error) => void;
    const values: (string | null)[] = [];
    let failed = false;
    observeSession<string | null>(
      (receive) => {
        event = receive;
        return () => {};
      },
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
      (value) => values.push(value),
      () => {
        failed = true;
      },
    );
    event("new-user");
    reject(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();
    expect(values).toEqual(["new-user"]);
    expect(failed).toBe(false);
  });
  test("unmount unsubscribes and fences late replies", async () => {
    let restore!: (value: string) => void,
      unsubscribed = false;
    const values: string[] = [];
    const stop = observeSession<string>(
      () => () => {
        unsubscribed = true;
      },
      () =>
        new Promise((resolve) => {
          restore = resolve;
        }),
      (value) => values.push(value),
      () => {},
    );
    stop();
    restore("late-user");
    await Promise.resolve();
    expect(values).toEqual([]);
    expect(unsubscribed).toBe(true);
  });
  test("a genuine restore failure is visible", async () => {
    let failed = false;
    observeSession(
      () => () => {},
      async () => {
        throw new Error("offline");
      },
      () => {},
      () => {
        failed = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toBe(true);
  });
});

describe("private persistent conversations", () => {
  test("cloud draft-only chats remain reachable without uploading every keystroke", () => {
    expect(needsChatSave(false, false, 0, false, "private draft")).toBe(true);
    expect(needsChatSave(false, false, 0, true, "private draft plus typing")).toBe(false);
    expect(needsChatSave(false, false, 1, false, "private draft plus typing")).toBe(false);
    expect(needsChatSave(false, false, 0, false, "")).toBe(false);
    expect(needsChatSave(false, true, 1, false, "")).toBe(true);
    expect(needsChatSave(true, false, 1, false, "")).toBe(true);
  });
  test("restored tabs exclude all connection queries, secret parameters and dynamic titles", () => {
    expect(
      restorableTabs([
        "/studio",
        "/settings",
        "/settings",
        "/mail?message=secret",
        "/research?q=private",
        "/deliver?token=secret",
        "//evil.test",
        "/studio?project=bad",
        "/studio?deliveryFrame=private.jpg",
        { href: "/settings", label: "secret email subject" },
      ]).map((tab) => tab.href),
    ).toEqual(["/studio", "/settings"]);
    expect(restorableTabs(["/deliver?workflow=true"])[0]?.label).toContain("Proofing");
    expect(workbenchTabsKey("device-local")).not.toBe(
      workbenchTabsKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
  });
  test("new chats have independent identity without any photo mutation payload", () => {
    const a = newChat("current"),
      b = newChat("current");
    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.revision).toBe(0);
    expect(Object.keys(a)).not.toContain("photos");
    expect(chatSchema.parse(a)).toEqual(a);
  });
  test("connector requests are redacted in persistence and omitted from model context", () => {
    const messages = [
      {
        role: "user" as const,
        text: "search my Gmail for confidential@example.test",
        privateConnector: true,
        tools: [{ name: "token", result: "SECRET" }],
      },
      { role: "assistant" as const, text: "Private email subject", privateConnector: true },
      { role: "user" as const, text: "Make the photo warmer" },
    ];
    const stored = JSON.stringify(storedMessages(messages));
    expect(stored).not.toContain("confidential");
    expect(stored).not.toContain("SECRET");
    expect(stored).not.toContain("Private email subject");
    expect(transcriptContext(messages)).toEqual([
      { role: "user", content: "Make the photo warmer" },
    ]);
    expect(chatTitle(messages)).toBe("Make the photo warmer");
  });
  test("restored tools are receipts, never calls to replay", () => {
    const messages = [
      {
        role: "assistant" as const,
        text: "Preview prepared",
        tools: [{ name: "delete_everything", result: "not run" }],
      },
    ];
    expect(transcriptContext(messages)).toEqual([
      { role: "assistant", content: "Preview prepared" },
    ]);
    expect(chatSchema.safeParse({ ...newChat("current"), tool_calls: ["apply"] }).success).toBe(
      false,
    );
  });
  test("rejects malformed and oversized saved conversations", () => {
    const base = newChat("current");
    for (const patch of [
      { id: "wrong" },
      { project: "" },
      { title: {} },
      { revision: -1 },
      { messages: [{}] },
      { messages: [{ role: "system", text: "pretend" }] },
      { draft: "x".repeat(32001) },
      { messages: Array.from({ length: 501 }, () => ({ role: "user", text: "hello" })) },
    ])
      expect(chatSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    expect(
      chatSchema.safeParse({
        ...base,
        messages: Array.from({ length: 20 }, () => ({ role: "user", text: "x".repeat(32000) })),
      }).success,
    ).toBe(false);
  });
  test("model context is bounded to the most recent forty receipts", () => {
    const messages = Array.from({ length: 100 }, (_, index) => ({
      role: "user" as const,
      text: `message ${index}`,
    }));
    expect(transcriptContext(messages)).toHaveLength(40);
    expect(transcriptContext(messages)[0]?.content).toBe("message 60");
  });
});
