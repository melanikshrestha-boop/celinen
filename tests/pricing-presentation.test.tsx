import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "postcss";

const fixtureFlag = "--pricing-presentation-fixture";

if (!process.argv.includes(fixtureFlag)) {
  test("pricing renders every paid selection and the account-aware free entry in isolation", () => {
    const run = Bun.spawnSync([process.execPath, fileURLToPath(import.meta.url), fixtureFlag], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);
    expect(new TextDecoder().decode(run.stdout)).toContain("PRICING_PRESENTATION_OK");
  });

  test("pricing styles are scoped and inherit the public sky typography", () => {
    const source = readFileSync(new URL("../src/routes/pricing.tsx", import.meta.url), "utf8");
    const css = readFileSync(
      new URL("../src/components/marketing/pricing-page.css", import.meta.url),
      "utf8",
    );
    let rules = 0;
    parse(css).walkRules((rule) => {
      rules++;
      for (const selector of rule.selectors) expect(selector).toStartWith(".marketing-pricing");
    });
    expect(rules).toBeGreaterThan(30);
    expect(source).toContain("<Nav landing />");
    expect(source).toContain("<MarketingFooter />");
    expect(source.indexOf('import "@/components/marketing/sky-entry.css"')).toBeGreaterThan(
      source.indexOf('import "@/components/marketing/marketing-page.css"'),
    );
    expect(css).toContain("font-family: var(--font-sans)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/\.workbench|\.develop-|--foto-font-ui|documentElement/);
    expect(source).not.toMatch(/localStorage|indexedDB|savePreferences|ThemeToggle/);
    expect(source).toContain("onPointerMove={followAudience}");
    expect(source).toContain("onPointerEnter={followAudience}");
    expect(source).toContain("pricing-audiences__thumb");
    expect(source).toContain("pricing-period");
    expect(source).toContain("pricing-figure");
    expect(source).toContain("Math.floor(t * AUDIENCES.length)");
    expect(css).toContain(".pricing-audiences.is-live .pricing-audiences__thumb");
    expect(css).toContain("transition: none");
    expect(source).toContain("useMarketingMotion()");
    expect(source).not.toContain("PlanCheckout");
    expect(source).not.toContain("recordSignup");
    expect(source).not.toContain("Choose your plan");
    expect(source).not.toContain("you@studio.com");
    expect(css).toContain("white-space: nowrap");
    expect(css).toContain("flex-wrap: nowrap");
    expect(css).not.toContain(".pricing-pay");
    expect(css).not.toMatch(/\.pricing-plans small \{\s*display:\s*block/);
  });
} else {
  // Disposable process: hook/router mocks never contaminate the shared Bun suite.
  globalThis.fetch = (() => {
    throw new Error("Pricing must not contact a provider during rendering");
  }) as typeof fetch;
  for (const name of ["localStorage", "indexedDB"])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`Pricing must not access ${name}`);
      },
    });
  const react = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  let cursor = 0;
  const state = new Map<number, unknown>();
  mock.module("react", () => ({
    ...react,
    useState: (initial: unknown) => {
      const key = cursor++;
      if (!state.has(key)) state.set(key, typeof initial === "function" ? initial() : initial);
      return [
        state.get(key),
        (next: unknown) => state.set(key, typeof next === "function" ? next(state.get(key)) : next),
      ];
    },
  }));
  const navigations: unknown[] = [];
  mock.module("@tanstack/react-router", () => ({
    createFileRoute: () => (options: unknown) => ({ options }),
    useNavigate: () => async (options: unknown) => {
      navigations.push(options);
    },
    Link: ({
      to,
      search,
      children,
      ...props
    }: {
      to: string;
      search?: Record<string, string>;
      children?: React.ReactNode;
    }) => {
      const query = new URLSearchParams(search).toString();
      return react.createElement(
        "a",
        { ...props, href: to + (query ? `?${query}` : "") },
        children,
      );
    },
  }));
  mock.module("@/utils/payments.functions", () => ({
    createCheckoutSession: Symbol("create-checkout-session"),
  }));
  mock.module("@/components/StripeEmbeddedCheckout", () => ({
    StripeEmbeddedCheckout: ({ priceId }: { priceId: string }) =>
      react.createElement("div", { "data-stripe-price": priceId }, "Stripe checkout"),
  }));
  mock.module("@tanstack/react-start", () => ({
    useServerFn: () => async () => ({ ok: true }),
  }));
  let accountStatus: "loading" | "in" | "out" | undefined;
  mock.module("@/components/account/AccountProvider", () => ({
    useAccount: () => (accountStatus ? { status: accountStatus } : undefined),
  }));
  mock.module("@/components/Nav", () => ({
    Nav: ({ landing }: { landing?: boolean }) =>
      react.createElement("nav", {
        "aria-label": landing ? "Public navigation" : "Workspace navigation",
      }),
  }));
  mock.module("@/components/marketing/MarketingFooter", () => ({
    MarketingFooter: () => react.createElement("footer", null, "FOTO"),
  }));

  const { Route } = await import("../src/routes/pricing");
  const component = Route.options.component;
  assert.ok(component);
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const render = () => {
    cursor = 0;
    return renderToStaticMarkup(react.createElement(component));
  };
  const links = (html: string) =>
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
      label: text(match[2]!),
      url: new URL(
        match[1]!.match(/href="([^"]+)"/)![1]!.replaceAll("&amp;", "&"),
        "https://foto.test",
      ),
    }));
  let scenarios = 0;
  for (const status of [undefined, "loading", "out", "in"] as const) {
    accountStatus = status;
    for (const cycle of ["monthly", "yearly"]) {
      for (const audience of ["personal", "teams", "enterprise"]) {
        const tiers =
          audience === "personal"
            ? ([
                ["starter", 20, 16],
                ["sideline", 60, 48],
                ["arena", 200, 160],
              ] as const)
            : audience === "teams"
              ? ([
                  ["crew", 40, 32],
                  ["agency", 80, 64],
                ] as const)
              : ([["agency", 80, 64]] as const);
        for (const [index, [plan, monthly, yearly]] of tiers.entries()) {
          state.clear();
          state.set(0, cycle);
          state.set(1, audience);
          state.set(2, audience === "personal" ? index : 0);
          state.set(3, audience === "teams" ? index : 0);
          const html = render();
          const visible = text(html);
          assert.match(html, /class="marketing-page marketing-pricing"/);
          assert.match(html, /<main id="pricing-content" tabindex="-1"/);
          assert.match(html, /aria-label="Public navigation"/);
          assert.doesNotMatch(
            visible,
            /\$|prorated|SSO and seat management|Cancel any time|within 14 days|100 photos per month|Everything in Free|catalog import/,
          );
          assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
          assert.match(visible, /USD/);
          const list = links(html);
          if (audience !== "enterprise") {
            const free = list.find(
              (link) => link.label === (status === "in" ? "Open workspace" : "Create free account"),
            );
            assert.ok(free);
            assert.equal(free.url.pathname, status === "in" ? "/workspace" : "/auth");
            assert.equal(free.url.searchParams.has("plan"), false);
            if (status !== "in") {
              assert.equal(free.url.searchParams.get("mode"), "signup");
              assert.equal(free.url.searchParams.get("next"), "/workspace");
            }
            const paid = list.find(
              (link) => link.label === (audience === "teams" ? "Choose Teams" : "Choose Pro"),
            );
            assert.ok(paid);
            assert.equal(paid.url.pathname, "/signup");
            assert.equal(paid.url.searchParams.get("plan"), plan);
            assert.equal(paid.url.searchParams.get("billing"), cycle);
            assert.ok(visible.includes(`USD ${cycle === "yearly" ? yearly : monthly}`));
            assert.ok(visible.includes(`USD ${(monthly - yearly) * 12}`));
            if (cycle === "yearly") assert.ok(visible.includes(`USD ${yearly * 12}`));
            assert.doesNotMatch(html, /class="pricing-pay"/);
            assert.doesNotMatch(visible, /Choose your plan|you@studio\.com|Studio name|Continue to checkout/);
          } else {
            const business = list.find((link) => link.label === "Get Business");
            assert.equal(business?.url.searchParams.get("plan"), "agency");
            assert.equal(business?.url.searchParams.get("billing"), "yearly");
            assert.ok(visible.includes("USD 64"));
            assert.ok(visible.includes("USD 768"));
          }
          scenarios++;
        }
      }
    }
  }
  state.clear();
  state.set(0, "yearly");
  state.set(1, "personal");
  state.set(2, 0);
  const amountHtml = render();
  assert.doesNotMatch(amountHtml, /Pay · USD/);

  const { SavingsSection } = await import("../src/components/marketing/SavingsSection");
  state.clear();
  cursor = 0;
  let estimate = text(renderToStaticMarkup(react.createElement(SavingsSection, null, "Start")));
  assert.doesNotMatch(estimate, /\$/);
  assert.match(estimate, /USD 24,960/);
  assert.match(estimate, /USD 24,000/);
  assert.match(estimate, /USD 960/);
  state.set(0, {
    hoursPerWeek: "0",
    hourlyValue: "50",
    weeksPerYear: "48",
    replacedMonthlyCost: "0",
    lensMonthlyBudget: "40.10",
  });
  cursor = 0;
  estimate = text(renderToStaticMarkup(react.createElement(SavingsSection, null, "Start")));
  assert.match(estimate, /-USD 481\.20/);
  assert.match(estimate, /Time value is not cash income/);
  console.log(
    `PRICING_PRESENTATION_OK: ${scenarios} plan/account render scenarios; Stripe pay control; unchanged savings with explicit USD`,
  );
}
