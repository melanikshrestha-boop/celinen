import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--setup-presentation-fixture")) {
  test("first-login presentation preserves the real onboarding form and account actions", () => {
    const result = Bun.spawnSync(
      [process.execPath, fileURLToPath(import.meta.url), "--setup-presentation-fixture"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("SETUP_PRESENTATION_OK");
  });
  test("every welcome-screen style is scoped away from shared Settings", () => {
    const css = readFileSync(
      new URL("../src/components/account/account-setup.css", import.meta.url),
      "utf8",
    );
    for (const [, selector] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)) {
      if (selector.trim().startsWith("@media")) continue;
      expect(selector).toContain(".account-setup");
    }
    expect(css).toContain("body:has(.account-setup) .profile-specialty-popover");
    expect(css).toContain("color-scheme: light");
    expect(css).toContain('"OpenAI Sans"');
    expect(css).toContain("background: var(--auth-blue)");
    expect(css).toContain(":focus-visible");
  });
} else {
  globalThis.fetch = (() => {
    throw new Error("No network in onboarding presentation QA");
  }) as typeof fetch;
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  let signOutCalls = 0;
  const account = {
    scope: "qa-onboarding-only",
    name: "Sample Photographer",
    workspaceName: "Preserved studio",
    biography: "Existing private biography",
    avatar: "",
    specialties: ["portrait"],
    customSpecialty: "",
    user: { email: "example@example.test" },
    local: false,
    error: "",
    saveProfile() {
      throw new Error("Rendering must never save a profile");
    },
    async signOut() {
      signOutCalls++;
    },
  };
  mock.module("@/components/account/AccountProvider", () => ({ useAccount: () => account }));
  mock.module("@/components/workbench/useToolLeaveGuard", () => ({ useToolLeaveGuard() {} }));
  const { AccountSetup } = await import("../src/components/account/AccountSetup");
  const { ProfileForm } = await import("../src/components/account/ProfileForm");
  const html = renderToStaticMarkup(createElement(AccountSetup));
  assert.ok(html.includes('<main class="auth-screen account-setup">'));
  assert.ok(!html.includes("workbench-lock"));
  assert.ok(html.includes('aria-labelledby="account-setup-title"'));
  assert.ok(html.includes("Make yourself at home."));
  assert.ok(html.includes("example@example.test"));
  assert.ok(html.includes('src="/images/foto-open-sky.webp"'));
  assert.ok(html.includes('alt="" aria-hidden="true"'));
  assert.ok(html.includes('id="profile-display-name"'));
  assert.ok(html.includes('value="Sample Photographer"'));
  assert.ok(html.includes('id="profile-specialties"'));
  assert.ok(html.includes("Portrait"));
  assert.ok(html.includes("Open workspace →"));
  assert.ok(!html.includes('id="profile-biography"'));
  assert.ok(!html.includes("Save changes"));
  const settings = renderToStaticMarkup(createElement(ProfileForm));
  assert.ok(settings.includes('id="profile-biography"'));
  assert.ok(settings.includes("Existing private biography"));
  assert.ok(settings.includes("Save changes"));
  assert.ok(!settings.includes("auth-screen"));
  assert.equal(signOutCalls, 0);
  type Node = { type?: unknown; key?: string | null; props?: Record<string, unknown> };
  function find(value: unknown, predicate: (node: Node) => boolean): Node | undefined {
    if (Array.isArray(value)) return value.map((child) => find(child, predicate)).find(Boolean);
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    return predicate(node) ? node : find(node.props?.children, predicate);
  }
  const tree = AccountSetup();
  const profile = find(tree, (node) => node.type === ProfileForm)!;
  assert.equal(profile.key, account.scope, "account changes retain the profile remount boundary");
  assert.equal(profile.props!.onboarding, true);
  const alternate = find(
    tree,
    (node) => node.type === "button" && node.props?.className === "settings-text-action",
  )!;
  (alternate.props!.onClick as () => void)();
  assert.equal(signOutCalls, 1);
  account.error = "Unable to sign out. Please try again.";
  const failure = renderToStaticMarkup(createElement(AccountSetup));
  assert.ok(failure.includes('role="alert" class="account-setup-error"'));
  assert.ok(failure.includes(account.error));
  console.log("SETUP_PRESENTATION_OK");
}
