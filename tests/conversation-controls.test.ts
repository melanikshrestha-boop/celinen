import { describe, expect, test } from "bun:test";
import { chatSchema, newChat } from "../src/lib/chat-history";
import { clientTranscript, chatShareHtml, chatShareFile } from "../src/lib/chat-sharing";
import {
  ACCENT_COLORS,
  DEFAULT_APPEARANCE,
  normalizeColor,
  validateAppearance,
  exportTheme,
  importTheme,
} from "../src/lib/appearance";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS,
  shortcutsSchema,
  globalShortcut,
  recordedShortcut,
} from "../src/lib/shortcuts";
import { preferencesSchema, mergePreferencePatch } from "../src/lib/account-preferences";
import { assistantPersonalization } from "../src/lib/settings-transfer";
import { workspaceLanguage, workspaceText } from "../src/lib/workspace-language";
import { readFileSync } from "node:fs";

describe("Conversation controls and creative preferences", () => {
  test("old conversations gain metadata without changing messages or IDs", () => {
    const record = newChat("shoot-1");
    const { pinned: _pin, section: _section, unread: _unread, ...old } = record;
    expect(chatSchema.parse(old)).toEqual(record);
    expect(
      chatSchema.parse({ ...old, pinned: true, section: "Client reviews", unread: true }),
    ).toMatchObject({
      id: record.id,
      pinned: true,
      section: "Client reviews",
      unread: true,
      messages: [],
    });
    for (const patch of [
      { pinned: "yes" },
      { section: "x".repeat(61) },
      { unread: 1 },
      { photos: [] },
    ])
      expect(chatSchema.safeParse({ ...record, ...patch }).success).toBe(false);
  });
  test("client snapshot excludes private requests, receipts, draft and internal identifiers", () => {
    const record = {
      ...newChat("private-shoot"),
      title: "Client review",
      draft: "PRIVATE_DRAFT",
      messages: [
        { role: "user" as const, text: "Please pick a cover." },
        {
          role: "assistant" as const,
          text: "The second frame works best.",
          tools: [{ name: "mail", result: "PRIVATE_TOOL" }],
        },
        { role: "user" as const, text: "PRIVATE_EMAIL", privateConnector: true },
      ],
    };
    expect(clientTranscript(record)).toEqual({
      title: "Client review",
      messages: [
        { role: "user", text: "Please pick a cover." },
        { role: "assistant", text: "The second frame works best." },
      ],
    });
    const html = chatShareHtml(record);
    for (const secret of [record.id, record.project, record.draft, "PRIVATE_TOOL", "PRIVATE_EMAIL"])
      expect(html).not.toContain(secret);
    expect(html).toContain("default-src 'none'");
    expect(chatShareFile(record).name).toBe("Client review-LensLabs.html");
  });
  test("sharing escapes executable markup and retains transcript text", () => {
    const attack = '<img src=x onerror="alert(1)"></script><script>alert(2)</script>&';
    const record = {
      ...newChat("test"),
      title: "<script>oops</script>",
      messages: [{ role: "user" as const, text: attack }],
    };
    const html = chatShareHtml(record);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
    expect(clientTranscript(record).messages[0]!.text).toBe(attack);
  });
  test("all eight accent presets are readable and persist gradient, contrast and grid", () => {
    expect(ACCENT_COLORS.map(([name]) => name)).toEqual([
      "Default",
      "Blue",
      "Green",
      "Yellow",
      "Pink",
      "Orange",
      "Purple",
      "White",
    ]);
    for (const [, accent] of ACCENT_COLORS)
      for (const contrast of ["standard", "system", "more"] as const) {
        const theme = validateAppearance({
          ...DEFAULT_APPEARANCE,
          accent,
          contrast,
          grid: true,
          accentStyle: "gradient",
          accentEnd: "#ee88aa",
        });
        expect(importTheme(exportTheme(theme))).toEqual(theme);
      }
    expect(normalizeColor(" aBc ")).toBe("#aabbcc");
    expect(normalizeColor("ef0088")).toBe("#ef0088");
    for (const bad of ["red", "url(x)", "#12345678", "<script>", "1"]) {
      expect(() => normalizeColor(bad)).toThrow();
    }
    expect(() =>
      validateAppearance({ ...DEFAULT_APPEARANCE, accentEnd: "url(tracker)" }),
    ).toThrow();
    expect(() => validateAppearance({ ...DEFAULT_APPEARANCE, accent: "#121212" })).toThrow();
  });
  test("every shortcut has a configurable binding, conflicts and browser keys are rejected", () => {
    expect(Object.keys(DEFAULT_SHORTCUTS)).toEqual(SHORTCUTS.map((action) => action.id));
    for (const action of SHORTCUTS)
      expect(shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, [action.id]: "" })[action.id]).toBe("");
    expect(
      shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, togglePin: "Alt+Shift+9" }).togglePin,
    ).toBe("Alt+Shift+9");
    expect(() =>
      shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, togglePin: DEFAULT_SHORTCUTS.quickChat }),
    ).toThrow("Already assigned");
    for (const key of ["Mod+n", "Mod+l", "Mod+w", "Mod+Shift+n", "Alt+F4", "a", "Meta+X"])
      expect(globalShortcut.safeParse(key).success).toBe(false);
    expect(
      recordedShortcut({
        key: "π",
        code: "KeyP",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("Mod+Alt+p");
  });
  test("language and destination have real bounded preferences with safe old defaults", () => {
    const base = preferencesSchema.parse({});
    expect(base.language).toBe("en");
    expect(base.fileDestination).toBe("studio");
    const next = mergePreferencePatch(base, base, { language: "es", fileDestination: "adobe" });
    expect(assistantPersonalization(next)).toContain("Respond in Spanish");
    expect(workspaceLanguage("auto", "es-MX")).toBe("es");
    expect(workspaceLanguage("auto", "fr-FR")).toBe("en");
    expect(workspaceText("Appearance", "es")).toBe("Apariencia");
    expect(workspaceText("User supplied title", "es")).toBe("User supplied title");
    expect(
      preferencesSchema.safeParse({ ...base, fileDestination: "javascript:run()" }).success,
    ).toBe(false);
  });
  test("cloud deletion is authenticated, owner-scoped, revision-checked and conversation-only", () => {
    const sql = readFileSync(
      new URL("../drizzle/migrations/0020_conversation_controls.sql", import.meta.url),
      "utf8",
    );
    const remove = sql.slice(sql.indexOf("CREATE FUNCTION public.delete_workspace_chat"));
    for (const guard of [
      "auth.uid()",
      "expected_revision IS NULL",
      "prior.owner_id <> owner",
      "prior.project <> expected_project",
      "FOR UPDATE",
      "<> expected_revision",
      "WHERE id = chat_id AND owner_id = owner",
      "FROM PUBLIC, anon",
    ])
      expect(remove).toContain(guard);
    expect(remove).not.toMatch(/DELETE FROM (?!public.workspace_chats)/);
  });
});
