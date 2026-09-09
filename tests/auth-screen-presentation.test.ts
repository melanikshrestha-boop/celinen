import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "../src/lib/appearance";

if (!process.argv.includes("--auth-presentation-fixture")) {
  test("public auth preserves Google-first, accessible account and gallery entry", () => {
    const result = Bun.spawnSync(
      [process.execPath, fileURLToPath(import.meta.url), "--auth-presentation-fixture"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("AUTH_PRESENTATION_OK");
  });

  test("public auth has its own white sans theme and readable interactive colors", () => {
    const css = readFileSync(
      new URL("../src/components/account/auth-screen.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain('"OpenAI Sans"');
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("background: #fff");
    expect(css).not.toContain("auth-lens");
    expect(css).not.toContain("var(--font-sans)");
    expect(css).toContain("@media (max-width: 800px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
    const color = (name: string) => css.match(new RegExp(`--auth-${name}: (#[a-f0-9]+);`))![1];
    expect(contrastRatio(color("text"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color("muted"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color("blue"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
} else {
  // Real component rendering, but no provider, network, browser, or customer storage.
  globalThis.fetch = (() => {
    throw new Error("Unexpected auth presentation network access");
  }) as typeof fetch;
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const router = await import("@tanstack/react-router");
  mock.module("@tanstack/react-router", () => ({
    ...router,
    Link: ({
      to,
      search,
      children,
      ...props
    }: {
      to: string;
      search?: Record<string, string>;
      children?: React.ReactNode;
    }) =>
      createElement(
        "a",
        {
          ...props,
          href: to + (search ? `?${new URLSearchParams(search)}` : ""),
        },
        children,
      ),
  }));
  mock.module("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
  mock.module("@/lib/auth/oauth", () => ({
    signInWithOAuth: () => {
      throw new Error("Rendering must not start authentication");
    },
  }));
  const { AuthScreen } = await import("../src/components/account/AuthScreen");
  const { PRODUCT_NAME } = await import("../src/lib/product");
  const next = "/shoots/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/develop?frame=original";
  for (const mode of ["signup", "signin"] as const) {
    const html = renderToStaticMarkup(
      createElement(AuthScreen, {
        next,
        mode,
        onAuthenticated: () => {
          throw new Error("Rendering must not authenticate");
        },
      }),
    );
    assert.match(html, /<main class="auth-screen">/);
    assert.match(
      html,
      /class="auth-scene-image"[^>]*src="\/images\/foto-open-sky.webp"[^>]*alt=""[^>]*aria-hidden="true"/,
    );
    assert.ok(html.includes("Make room for your next great shot."));
    assert.ok(html.indexOf("Continue with Google") < html.indexOf('<form class="auth-form"'));
    assert.ok(html.includes('<section class="auth-panel" aria-labelledby="auth-title">'));
    assert.ok(html.includes('id="auth-title"'));
    assert.ok(
      html.includes(mode === "signup" ? "Create Your Account" : `Sign in to ${PRODUCT_NAME}`),
    );
    assert.ok(html.includes('<label for="auth-email">'));
    assert.ok(html.includes('<label for="auth-password">'));
    const email = html.match(/<input[^>]*id="auth-email"[^>]*>/)![0];
    assert.ok(email.includes('name="email"'));
    assert.ok(email.includes('type="email"'));
    assert.ok(html.includes('aria-label="Show password"'));
    assert.ok(html.includes('aria-live="polite" aria-atomic="true"'));
    assert.ok(html.includes('<fieldset disabled="">'), "SSR must not enable auth before hydration");
    assert.ok(
      html.includes(encodeURIComponent(next)),
      "switching mode preserves exact safe return",
    );
    if (mode === "signup") {
      assert.ok(html.includes('<label for="auth-name">'));
      assert.ok(html.includes('autoComplete="new-password"'));
    } else {
      assert.ok(!html.includes('id="auth-name"'));
      assert.ok(html.includes('autoComplete="current-password"'));
      assert.ok(html.includes("Email me a sign-in link instead"));
    }
  }
  const gallery = renderToStaticMarkup(
    createElement(AuthScreen, {
      next,
      mode: "signup",
      source: "client-gallery",
      onAuthenticated() {},
    }),
  );
  assert.ok(gallery.includes("You don’t need this account to receive your photos."));
  assert.ok(gallery.includes("source=client-gallery"));
  console.log("AUTH_PRESENTATION_OK");
}
