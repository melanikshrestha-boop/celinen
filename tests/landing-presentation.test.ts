import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "postcss";
import { contrastRatio } from "../src/lib/appearance";

const fixtureFlag = "--landing-presentation-fixture";

if (!process.argv.includes(fixtureFlag)) {
  test("public sky landing renders real content and account-aware entry links in isolation", () => {
    const result = Bun.spawnSync([process.execPath, fileURLToPath(import.meta.url), fixtureFlag], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("LANDING_PRESENTATION_OK");
  });

  test("public mountain image is a compact local WebP with the declared intrinsic dimensions", () => {
    const bytes = readFileSync(new URL("../public/images/foto-open-sky.webp", import.meta.url));
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
    expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
    expect(bytes.length).toBeLessThan(250 * 1024);
    let dimensions: [number, number] | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      const data = offset + 8;
      expect(data + length).toBeLessThanOrEqual(bytes.length);
      if (kind === "VP8X") {
        dimensions = [bytes.readUIntLE(data + 4, 3) + 1, bytes.readUIntLE(data + 7, 3) + 1];
        break;
      }
      if (kind === "VP8 ") {
        expect(bytes.subarray(data + 3, data + 6)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]));
        dimensions = [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
        break;
      }
      if (kind === "VP8L") {
        expect(bytes[data]).toBe(0x2f);
        const packed = bytes.readUInt32LE(data + 1);
        dimensions = [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
        break;
      }
      offset = data + length + (length % 2);
    }
    expect(dimensions).toEqual([1672, 941]);
  });

  test("sky typography and light colors are scoped to public marketing selectors", () => {
    const css = readFileSync(
      new URL("../src/components/marketing/sky-entry.css", import.meta.url),
      "utf8",
    );
    const stylesheet = parse(css);
    let rules = 0;
    stylesheet.walkRules((rule) => {
      rules++;
      for (const selector of rule.selectors) {
        expect(selector, "Public styles must not target body, root, or workspace controls").toMatch(
          /^\.marketing-[a-z0-9_-]+(?:$|[\s>+~:.[#])/i,
        );
      }
    });
    expect(rules).toBeGreaterThan(20);
    const publicRoot = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".marketing-page",
    );
    assert.ok(publicRoot?.type === "rule");
    const declaration = (name: string) => {
      const match = publicRoot.nodes.find((node) => node.type === "decl" && node.prop === name);
      assert.ok(match?.type === "decl", `Missing public ${name}`);
      return match.value;
    };
    expect(declaration("--font-sans")).toContain('"OpenAI Sans"');
    expect(declaration("--font-display")).toContain("Instrument Serif");
    expect(declaration("color-scheme")).toBe("light");
    expect(declaration("background")).toBe("#fff");
    for (const name of ["--marketing-text", "--marketing-muted", "--marketing-accent"])
      expect(contrastRatio(declaration(name), "#ffffff"), name).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (max-width: 540px)");
    expect(css).toContain("@media (max-width: 1100px), (max-height: 840px)");
    expect(css).toContain(".marketing-nav-features--long");
    expect(css).toContain("max-height: min(70dvh");
    expect(css).toContain(".marketing-vista");
    expect(css).toMatch(/\.marketing-promises\s*\{[^}]*justify-content:\s*center/);
    expect(css).toMatch(/\.marketing-promises\s*\{[^}]*margin:\s*0 auto/);
    const motion = readFileSync(
      new URL("../src/components/marketing/marketing-motion.css", import.meta.url),
      "utf8",
    );
    expect(motion).toContain("animation: marketing-hero-develop");
    expect(motion).toContain("animation: marketing-hero-ken");
    expect(motion).toContain("animation: marketing-hero-rise");
    expect(motion).toContain("animation: marketing-bob");
    expect(motion).toContain("animation: marketing-wheel-turn");
    expect(motion).toContain("cubic-bezier(0.21, 0.68, 0.35, 1)");
    expect(css).toMatch(/\.marketing-hero\s*\{[^}]*border-radius:\s*28px/);
    expect(css).toMatch(/\.marketing-hero\s*\{[^}]*min\(100% - 40px/);
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).not.toMatch(/\.workbench|\.develop-|\.auth-|--foto-font-ui|auth-lens/);
    const source = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
    expect(source.indexOf('import "@/components/marketing/sky-entry.css"')).toBeGreaterThan(
      source.indexOf('import "@/components/marketing/marketing-page.css"'),
    );
    expect(source).not.toMatch(/localStorage|indexedDB|savePreferences|document\.documentElement/);
    expect(
      readFileSync(new URL("../public/fonts/openai-sans/OpenAISans-Regular.woff2", import.meta.url))
        .length,
    ).toBeGreaterThan(0);
    expect(
      readFileSync(
        new URL("../public/fonts/instrument-serif/InstrumentSerif-Regular.woff2", import.meta.url),
      ).length,
    ).toBeGreaterThan(0);
  });
} else {
  // All mocks live in this disposable child, never Bun's shared test module cache.
  globalThis.fetch = (() => {
    throw new Error("Public landing rendering must not access the network");
  }) as typeof fetch;
  for (const name of ["localStorage", "indexedDB"])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`Public landing rendering must not access ${name}`);
      },
    });
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
    }) => {
      const query = new URLSearchParams(search).toString();
      return createElement("a", { ...props, href: to + (query ? `?${query}` : "") }, children);
    },
  }));
  let status: "loading" | "in" | "out" | undefined;
  mock.module("@/components/account/AccountProvider", () => ({
    useAccount: () =>
      status === undefined
        ? undefined
        : {
            status,
            savePreferences() {
              throw new Error("Public landing must not change workspace preferences");
            },
          },
  }));
  const { Route } = await import("../src/routes/index");
  const component = Route.options.component;
  assert.ok(component);
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  for (const current of [undefined, "loading", "out", "in"] as const) {
    status = current;
    const html = renderToStaticMarkup(createElement(component));
    assert.match(html, /<div class="marketing-page">/);
    assert.match(html, /<main id="main-content" tabindex="-1">/i);
    assert.match(html, /<a[^>]*href="#main-content"[^>]*>Skip to content<\/a>/);
    const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    assert.equal(headings.length, 1);
    assert.equal(text(headings[0]![1]!), "Go where the good light takes you.");
    assert.ok(html.includes("A little space for your big ideas"));
    assert.ok(html.includes("Your shoots, edits, and galleries"));
    assert.ok(html.includes("Made for the person behind the camera"));
    assert.ok(html.includes("Take a look around"));
    assert.ok(!html.includes("Stay for the last light"));
    assert.ok(!html.includes("Keep the ones"));
    assert.ok(!html.includes("It learns from your photos and your edits"));
    assert.ok(!html.includes("marketing-learn"));
    const heroAt = html.indexOf('class="marketing-hero"');
    const statsAt = html.indexOf("marketing-stats");
    assert.ok(heroAt > 0 && statsAt > heroAt, "Stats follow the hero");
    assert.ok(!html.includes("marketing-vista__dissolve"));
    assert.ok(html.includes('aria-labelledby="home-heading"'));
    const hero = html.match(/<img\b[^>]*class="marketing-hero__image"[^>]*>/)![0];
    for (const expected of [
      'src="/images/foto-open-sky.webp"',
      'alt=""',
      'width="1672"',
      'height="941"',
      'fetchPriority="high"',
    ])
      assert.ok(hero.includes(expected), `Hero is missing ${expected}`);
    for (const image of html.matchAll(/<img\b[^>]*>/g)) {
      assert.ok(image[0].includes('alt=""'), "Illustrative scenery must remain decorative");
      assert.ok(image[0].includes('src="/images/foto-open-sky.webp"'));
    }
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    const startsWith = (label: string) =>
      links.filter((match) => text(match[2]!).startsWith(label));
    if (current === "in") {
      assert.equal(startsWith("Dashboard").length, 4);
    } else {
      assert.equal(startsWith("Get started").length, 3, "Hero, savings, and closing stay Get started");
      assert.equal(startsWith("Sign In").length, 1, "Nav CTA is Sign In");
    }
    for (const entry of current === "in"
      ? startsWith("Dashboard")
      : [...startsWith("Get started"), ...startsWith("Sign In")]) {
      const href = entry[1]!.match(/href="([^"]+)"/)![1]!.replaceAll("&amp;", "&");
      const url = new URL(href, "https://foto.test");
      assert.equal(url.pathname, current === "in" ? "/dashboard" : "/auth");
      if (current === "in") assert.equal(url.search, "");
      else {
        assert.equal(url.searchParams.get("next"), "/dashboard");
        const signingIn = text(entry[2]!).startsWith("Sign In");
        assert.equal(url.searchParams.get("mode"), signingIn ? "signin" : "signup");
        if (signingIn) assert.ok(url.searchParams.get("google"));
      }
    }
    assert.ok(!html.includes('id="features"'));
    assert.ok(html.includes("id=\"pricing\""));
    assert.ok(html.includes("USD 20"));
    assert.ok(html.includes("USD 30"));
    assert.ok(html.includes("$20"));
    assert.ok(html.includes("$30"));
    assert.ok(html.includes("Hobby"));
    assert.ok(html.includes("Billed yearly at $192"));
    assert.ok(html.includes("Save $48"));
    assert.ok(html.includes("Billed yearly at $288"));
    assert.ok(html.includes("Save $72"));
    assert.ok(html.includes("Creator"));
    assert.ok(html.includes("Enterprise"));
    assert.ok(html.includes("Most Popular"));
    assert.ok(!html.includes("Agency"));
    assert.ok(!html.includes("Sideline"));
    assert.ok(html.includes("credits/month"));
    assert.ok(html.includes("credits per month"));
    assert.ok(html.includes("REST API"));
    assert.ok(html.includes(">MCP<"));
    assert.ok(!html.includes(">More<"));
    assert.ok(html.includes('aria-label="Open menu"'));
    assert.ok(html.includes("Features"));
    assert.ok(html.includes("Use Cases"));
    assert.match(html, /Photographers/);
    assert.match(html, /Galleries sent/);
    assert.match(html, /Frames picked/);
    assert.ok(!html.includes("$16"));
    assert.ok(html.includes('id="connectors"'));
    assert.match(html, /Connectors/);
    const connectors = readFileSync(
      new URL("../src/components/marketing/IntegrationsSection.tsx", import.meta.url),
      "utf8",
    );
    expect(connectors).toContain("orbitPose");
    expect(connectors).toContain("data-reveal");
    expect(connectors).toContain("instagram");
    expect(connectors).toContain("adobe");
    expect(connectors).toContain("lightroom");
    expect(connectors).toContain("photoshop");
    expect(connectors).toContain("Lightroom Classic");
    expect(connectors).toContain("stripe");
    expect(connectors).toContain("tiktok");
    expect(connectors).toContain("youtube");
    assert.match(html, />Accept</);
    assert.match(html, />Reject</);
    assert.ok(html.includes('id="workflow"'));
    assert.ok(html.includes("Lens, but less between you and your next shoot."));
    assert.ok(!html.includes("From the first frame"));
    assert.ok(html.includes('id="possibilities"'));
    assert.ok(html.includes("Less busywork."));
    assert.ok(html.includes("Find your favorites."));
    assert.ok(html.includes("Start small. Dream in full frame."));
    assert.ok(html.includes('id="savings"'));
    for (const step of ["Import", "Cull", "Edit", "Finish", "Deliver"])
      assert.ok(html.includes(`<h3>${step}</h3>`), `Real workflow step ${step} is missing`);
    assert.ok(html.includes("Illustrative example · not measured results"));
    assert.ok(html.includes("Time value is not cash income"));
    assert.ok(html.includes("Publishing requires a connected account."));
    assert.equal(
      (
        html.match(
          /name="(?:hoursPerWeek|hourlyValue|weeksPerYear|replacedMonthlyCost|lensMonthlyBudget)"/g,
        ) ?? []
      ).length,
      5,
    );
    assert.ok(
      !html.includes("Toggle color mode"),
      "Public entry must not change the workspace theme",
    );
    const visible = text(html);
    assert.doesNotMatch(
      visible,
      /\b\d[\d,.]*\s*(?:k\+?|million)?\s+(?:active\s+)?(?:photographers|users|studios)\b/i,
    );
    assert.doesNotMatch(visible, /\b(?:3\s*seconds|3s|instantly|guaranteed savings|zero wait)\b/i);
    assert.doesNotMatch(
      visible,
      /\b(?:1,000|1000)\s+(?:RAW\s+)?(?:photos|files|frames)[^.]{0,60}\bseconds\b/i,
    );
    assert.ok(!html.includes("auth-lens.jpg"));
  }
  console.log("LANDING_PRESENTATION_OK");
}
