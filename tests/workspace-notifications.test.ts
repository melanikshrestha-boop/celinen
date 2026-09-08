import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  readPreferences,
} from "../src/lib/account-preferences";
import {
  notifyResponseReady,
  RESPONSE_READY,
  shouldNotify,
  WORKSPACE_NOTIFICATION,
} from "../src/lib/workspace-notifications";
import { findSpeechVoice } from "../src/lib/speech-voice";

describe("Codex-style response preferences", () => {
  test("notification policy honors focus and opt-out", () => {
    for (const focused of [true, false]) {
      expect(shouldNotify("off", focused)).toBe(false);
      expect(shouldNotify("always", focused)).toBe(true);
      expect(shouldNotify("unfocused", focused)).toBe(!focused);
    }
  });
  test("older preferences retain choices and do not opt into desktop permissions", () => {
    const prefs = readPreferences(JSON.stringify({ theme: "light", keepAwake: true }));
    expect(prefs.theme).toBe("light");
    expect(prefs.keepAwake).toBe(true);
    expect(prefs.desktopNotifications).toBe(false);
    expect(prefs.completionNotifications).toBe("unfocused");
    expect(prefs.voiceURI).toBe("");
    for (const patch of [
      { voiceURI: "x".repeat(1001) },
      { completionNotifications: "all" },
      { desktopNotifications: "yes" },
    ])
      expect(preferencesSchema.safeParse(patch).success).toBe(false);
  });
  test("voice resolution uses exact IDs and leaves unavailable preferences unchanged", () => {
    const voices = [{ voiceURI: "device:voice-A" }, { voiceURI: "device:voice-a" }];
    expect(findSpeechVoice(voices, "device:voice-a")).toBe(voices[1]);
    expect(findSpeechVoice(voices, "")).toBeNull();
    expect(findSpeechVoice(voices, "other-device")).toBeNull();
    expect(findSpeechVoice([], "device:voice-A")).toBeNull();
  });
  test("no DOM, no notification or permission prompt", () => {
    expect(notifyResponseReady(DEFAULT_PREFERENCES)).toBe("off");
  });
  test("denied or failing desktop delivery falls back without requesting permission", () => {
    const original = new Map(
      ["window", "document", "Notification"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    const events: Event[] = [];
    let permissionPrompts = 0;
    class UnavailableNotification {
      static permission = "denied";
      static requestPermission() {
        permissionPrompts++;
      }
      constructor() {
        throw new Error("Unsupported constructor");
      }
    }
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          Notification: UnavailableNotification,
          dispatchEvent: (event: Event) => events.push(event),
        },
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { visibilityState: "hidden", hasFocus: () => false },
      });
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: UnavailableNotification,
      });
      const prefs = { ...DEFAULT_PREFERENCES, desktopNotifications: true };
      expect(notifyResponseReady(prefs)).toBe("in-app");
      UnavailableNotification.permission = "granted";
      expect(notifyResponseReady(prefs)).toBe("in-app");
      expect(notifyResponseReady({ ...prefs, completionNotifications: "off" })).toBe("off");
      expect(events.map((event) => event.type)).toEqual([
        WORKSPACE_NOTIFICATION,
        WORKSPACE_NOTIFICATION,
      ]);
      expect(permissionPrompts).toBe(0);
    } finally {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  test("alerts have fixed privacy-safe copy, and voice preferences are consumed", () => {
    expect(RESPONSE_READY).toBe("A response is ready to review in your chat.");
    const chat = readFileSync(
      new URL("../src/components/studio/CullChat.tsx", import.meta.url),
      "utf8",
    );
    expect(chat).toContain("notifyResponseReady(notificationPreferences.current)");
    expect(chat).toContain('voiceURI={account?.preferences.voiceURI ?? ""}');
    const voice = readFileSync(
      new URL("../src/components/account/ReadReply.tsx", import.meta.url),
      "utf8",
    );
    expect(voice).toContain("findSpeechVoice(window.speechSynthesis.getVoices(), voiceURI)");
  });
});
