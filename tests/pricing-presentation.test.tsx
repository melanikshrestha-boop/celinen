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
  const signups: unknown[] = [];
  let signupFails = false;
  mock.module("@/utils/payments.functions", () => ({ recordSignup: Symbol("record-signup") }));
  mock.module("@tanstack/react-start", () => ({
    useServerFn: () => async (input: unknown) => {
      signups.push(input);
      return signupFails ? { error: "Checkout unavailable" } : { ok: true };
    },
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

  // Capture the real rendered form handler; no duplicated signup implementation.
  const runtime = await import("react/jsx-runtime");
  let submit: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  const capture =
    (factory: typeof runtime.jsx) =>
    (
      type: Parameters<typeof runtime.jsx>[0],
      props: Parameters<typeof runtime.jsx>[1],
      key?: Parameters<typeof runtime.jsx>[2],
    ) => {
      if (type === "form" && typeof props?.onSubmit === "function") submit = props.onSubmit;
      return factory(type, props, key);
    };
  mock.module("react/jsx-runtime", () => ({
    ...runtime,
    jsx: capture(runtime.jsx),
    jsxs: capture(runtime.jsxs),
  }));
  const devRuntime = await import("react/jsx-dev-runtime");
  const originalDevJsx = devRuntime.jsxDEV;
  mock.module("react/jsx-dev-runtime", () => ({
    ...devRuntime,
    jsxDEV: (...args: Parameters<typeof devRuntime.jsxDEV>) => {
      if (args[0] === "form" && typeof args[1]?.onSubmit === "function") submit = args[1].onSubmit;
      return originalDevJsx(...args);
    },
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
    submit = undefined;
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
            /\$|Most popular|prorated|SSO and seat management|Cancel any time|within 14 days|100 photos per month|Everything in Free|catalog import/,
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
              (link) => link.label === (audience === "teams" ? "Get Teams" : "Get Pro"),
            );
            assert.ok(paid);
            assert.equal(paid.url.pathname, "/signup");
            assert.equal(paid.url.searchParams.get("plan"), plan);
            assert.equal(paid.url.searchParams.get("billing"), cycle);
            assert.ok(visible.includes(`USD ${cycle === "yearly" ? yearly : monthly}`));
            assert.ok(visible.includes(`USD ${(monthly - yearly) * 12}`));
            if (cycle === "yearly") assert.ok(visible.includes(`USD ${yearly * 12}`));
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
  // A selected paid upgrade keeps the same normalized payload and destination.
  state.clear();
  state.set(0, "monthly");
  state.set(1, "teams");
  state.set(3, 1);
  state.set(5, " PHOTOGRAPHER@EXAMPLE.COM ");
  state.set(6, "Test Studio");
  render();
  assert.ok(submit, "Actual upgrade form handler must render");
  await submit({ preventDefault() {} });
  assert.deepEqual(signups.at(-1), {
    data: {
      email: "photographer@example.com",
      plan: "agency",
      billing: "monthly",
      studio: "Test Studio",
    },
  });
  assert.deepEqual(navigations.at(-1), {
    to: "/signup",
    search: { plan: "agency", billing: "monthly", email: "photographer@example.com" },
  });
  const navigationCount = navigations.length;
  signupFails = true;
  state.set(8, false);
  render();
  assert.ok(submit);
  await submit({ preventDefault() {} });
  assert.equal(navigations.length, navigationCount, "Failed signup must not appear successful");
  assert.match(text(render()), /Checkout unavailable/);

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
    `PRICING_PRESENTATION_OK: ${scenarios} plan/account render scenarios; real upgrade submission; unchanged savings with explicit USD`,
  );
}
