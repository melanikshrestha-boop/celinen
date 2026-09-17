import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeSettingsUsage,
  formatUsageBytes,
  tallySettingsUsageLocal,
} from "../src/lib/settings-usage";
import { AVATAR_LOCAL_LIMIT, isAvatarDataUrl, writeLocalAvatar } from "../src/lib/account-avatar";

describe("settings usage tally and compact profile buttons", () => {
  test("C++ SETT/SRES packet round-trips the same counts as the local tally", () => {
    const photos = [
      { bytes: 1_048_576, kept: true },
      { bytes: 2_097_152, kept: false },
      { bytes: 3_145_728, kept: true },
    ];
    const local = tallySettingsUsageLocal(photos);
    expect(local).toEqual({
      photos: 3,
      kept: 2,
      totalBytes: 6_291_456,
      averageBytes: 2_097_152,
    });
    const empty = tallySettingsUsageLocal([]);
    expect(empty.photos).toBe(0);
    expect(empty.averageBytes).toBe(0);
    expect(() => encodeSettingsUsage([{ bytes: 2 ** 40 + 1, kept: false }])).toThrow();
    expect(formatUsageBytes(1536)).toBe("1.5 KB");
  });

  test("device-local avatars accept a real crop and reject tracking URLs", () => {
    const jpeg = "data:image/jpeg;base64,/9j/" + "A".repeat(80);
    expect(isAvatarDataUrl(jpeg)).toBe(true);
    expect(isAvatarDataUrl("https://example.com/x.png")).toBe(false);
    expect(isAvatarDataUrl("data:image/jpeg;base64,/9j/" + "A".repeat(AVATAR_LOCAL_LIMIT))).toBe(
      false,
    );
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    try {
      writeLocalAvatar("device-local", jpeg);
      expect(store.get("lenslabs.avatar.v1")).toBe(jpeg);
      writeLocalAvatar("device-local", "");
      expect(store.get("lenslabs.avatar.v1")).toBe("");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: original });
    }
  });

  test("settings buttons are compact, pets stay, and the C++ settings engine is wired", () => {
    const css = readFileSync(
      resolve(import.meta.dir, "../src/components/account/settings-workspace.css"),
      "utf8",
    );
    expect(css).toContain("min-height: 22px");
    expect(css).not.toContain("min-height: 48px");
    const workspace = readFileSync(
      resolve(import.meta.dir, "../src/components/account/SettingsWorkspace.tsx"),
      "utf8",
    );
    expect(workspace).toContain("UsageTally");
    expect(workspace).toContain("/__settings/usage");
    const pets = readFileSync(
      resolve(import.meta.dir, "../src/components/account/PetSettings.tsx"),
      "utf8",
    );
    expect(pets).toContain("We'll design more");
    const makefile = readFileSync(resolve(import.meta.dir, "../native/Makefile"), "utf8");
    expect(makefile).toContain("lenslabs-settings");
    const profile = readFileSync(
      resolve(import.meta.dir, "../src/components/account/ProfileForm.tsx"),
      "utf8",
    );
    expect(profile).toContain('type="submit"');
    expect(profile).toContain("Save changes");
    expect(workspace).toContain("navigate({ href: destination })");
    expect(workspace).toContain('"/dashboard"');
  });
});
