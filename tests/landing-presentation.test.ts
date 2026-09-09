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
    expect(declaration("--font-display")).toBe("var(--font-sans)");
    expect(declaration("color-scheme")).toBe("light");
    expect(declaration("background")).toBe("#fff");
    for (const name of ["--marketing-text", "--marketing-muted", "--marketing-accent"])
      expect(contrastRatio(declaration(name), "#ffffff"), name).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (max-width: 540px)");
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
    const label = current === "in" ? "Open workspace" : "Get started";
    const entries = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((match) =>
      text(match[2]!).startsWith(label),
    );
    assert.equal(
      entries.length,
      4,
      "Header, hero, savings, and closing CTA must share entry policy",
    );
    for (const entry of entries) {
      const href = entry[1]!.match(/href="([^"]+)"/)![1]!.replaceAll("&amp;", "&");
      const url = new URL(href, "https://foto.test");
      assert.equal(url.pathname, current === "in" ? "/workspace" : "/auth");
      if (current === "in") assert.equal(url.search, "");
      else {
        assert.equal(url.searchParams.get("mode"), "signup");
        assert.equal(url.searchParams.get("next"), "/workspace");
      }
    }
    assert.ok(html.includes('id="possibilities"'));
    assert.ok(html.includes('href="#possibilities"'));
    assert.ok(html.includes('id="workflow"'));
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
