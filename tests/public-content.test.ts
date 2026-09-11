import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "postcss";
import {
  findFotoArticle,
  fotoArticles,
  fotoReleases,
  publicDateLabel,
  publicContentHead,
} from "../src/lib/public-content";

const flag = "--public-content-fixture";

if (!process.argv.includes(flag)) {
  test("example field notes are listed without invented clipping copy", () => {
    expect(fotoArticles.map((article) => article.slug)).toEqual([
      "sports-photographer-genie",
      "sports-photo-editing-tips",
      "lightroom-vs-capture-one-2026",
      "send-a-gallery-the-same-night",
      "aftershoot-imagen-and-picking-yourself",
    ]);
    expect(JSON.stringify(fotoArticles)).not.toMatch(/viral|YouTube Automation/i);
    for (const slug of [
      "",
      "unknown",
      "__proto__",
      "constructor",
      "../product",
      "a-calmer-first-pass",
      "check-the-export",
      "a-clear-client-handoff",
      "CHECK-THE-EXPORT",
      "check-the-export/extra",
    ])
      expect(findFotoArticle(slug)).toBeUndefined();
  });

  test("changelog contains only the two verified release checkpoints, with explicit limits", () => {
    expect(fotoReleases.map((release) => release.id)).toEqual(["c079f4f", "6948a8f"]);
    expect(fotoReleases.every((release) => release.date === "2026-09-09")).toBe(true);
    expect(fotoReleases[0].note).toContain("not a bulk RAW speed guarantee");
    expect(fotoReleases[1].note).toContain("does not change your private workspace theme");
    const copy = JSON.stringify(fotoReleases);
    expect(copy).not.toMatch(
      /[0-9,]+\s+(active users|customers|photographers)|1000 photos|1,000 photos|3 seconds|100%|roadmap complete/i,
    );
    expect(publicContentHead("Field notes", "Practical photography notes.", "/blog")).toEqual({
      meta: [
        { title: "Field notes — celinen" },
        { name: "description", content: "Practical photography notes." },
        { property: "og:title", content: "Field notes — celinen" },
        { property: "og:description", content: "Practical photography notes." },
      ],
      links: [{ rel: "canonical", href: "https://lenslab.dev/blog" }],
    });
  });

  test("editorial styling remains public-scoped, responsive, and inherited sans", () => {
    const css = readFileSync(
      new URL("../src/components/marketing/public-editorial.css", import.meta.url),
      "utf8",
    );
    const stylesheet = parse(css);
    stylesheet.walkRules((rule) => {
      for (const selector of rule.selectors)
        expect(selector).toMatch(/^\.marketing-page \.public-editorial/);
    });
    expect(css).toContain("font-family: var(--font-sans)");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/\.workbench|\.foto-develop|:root|--foto-font-ui|@font-face/);
  });

  test("actual public routes render without accounts, storage, or network and handle unknown articles", () => {
    const result = Bun.spawnSync(
      [process.execPath, "--no-env-file", fileURLToPath(import.meta.url), flag],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("PUBLIC_CONTENT_OK");
  });
} else {
  globalThis.fetch = (() => {
    throw new Error("Public content must not access the network");
  }) as typeof fetch;
  for (const key of ["localStorage", "indexedDB"])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get() {
        throw new Error(`Unexpected ${key} access`);
      },
    });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const router = await import("@tanstack/react-router");
  mock.module("@tanstack/react-router", () => ({
    ...router,
    Link: ({
      to,
      params,
      search,
      hash,
      children,
      ...props
    }: {
      to: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      hash?: string;
      children?: React.ReactNode;
    }) => {
      let path = to;
      for (const [key, value] of Object.entries(params ?? {}))
        path = path.replace(`$${key}`, encodeURIComponent(value));
      const query = new URLSearchParams(search).toString();
      return createElement(
        "a",
        { ...props, href: path + (query ? `?${query}` : "") + (hash ? `#${hash}` : "") },
        children,
      );
    },
  }));
  mock.module("@/components/account/AccountProvider", () => ({ useAccount: () => undefined }));
  const product = await import("../src/routes/product");
  const galleries = await import("../src/routes/galleries");
  const blog = await import("../src/routes/blog.index");
  const article = await import("../src/routes/blog.$slug");
  const changelog = await import("../src/routes/changelog");
  const render = (component: React.ComponentType) => renderToStaticMarkup(createElement(component));
  const plain = (html: string) =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  for (const [route, path] of [
    [product.Route, "/product"],
    [galleries.Route, "/galleries"],
    [blog.Route, "/blog"],
    [changelog.Route, "/changelog"],
  ] as const) {
    const metadata = (route.options.head as () => ReturnType<typeof publicContentHead>)();
    assert.ok(metadata.meta[0].title.endsWith(" — celinen"));
    assert.ok(
      metadata.meta.some((item) => item.name === "description" && item.content.length > 20),
    );
    assert.equal(metadata.links[0].href, `https://lenslab.dev${path}`);
  }
  for (const page of [
    product.ProductPage,
    blog.BlogPage,
    changelog.ChangelogPage,
    article.ArticleNotFound,
  ]) {
    const html = render(page);
    assert.ok(html.includes('class="marketing-page"'));
    assert.ok(html.includes('id="main-content"'));
    assert.ok(html.includes('aria-label="Footer"'));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(!/<form\b/.test(html));
    assert.ok(!html.includes("Toggle color mode"));
  }
  const productHtml = render(product.ProductPage);
  assert.ok(productHtml.includes('id="why-foto"'));
  assert.ok(productHtml.includes('id="your-work"'));
  assert.ok(plain(productHtml).includes("Native image processing requires the local engine."));
  assert.ok(plain(productHtml).includes("publishing") || plain(productHtml).includes("Publishing"));
  const index = render(blog.BlogPage);
  const load = article.Route.options.loader;
  assert.equal(typeof load, "function");
  for (const post of fotoArticles) {
    assert.ok(index.includes(`href="/blog/${post.slug}"`));
    const loaded = await (load as (input: { params: { slug: string } }) => FotoArticleResult)({
      params: { slug: post.slug },
    });
    assert.equal(loaded.slug, post.slug);
    const html = renderToStaticMarkup(createElement(article.BlogArticle, { article: loaded }));
    assert.ok(plain(html).includes(post.title));
    assert.match(html, new RegExp(`datetime="${post.published}"`, "i"));
    assert.ok(html.includes('href="/blog"'));
    for (const section of post.sections) {
      assert.ok(plain(html).includes(section.title));
      for (const paragraph of section.paragraphs) assert.ok(plain(html).includes(paragraph));
    }
    const head = article.Route.options.head as (input: {
      loaderData: FotoArticleResult;
    }) => ReturnType<typeof publicContentHead>;
    const metadata = head({ loaderData: loaded });
    assert.equal(metadata.meta[0].title, `${post.title} — celinen`);
    assert.equal(metadata.links[0].href, `https://lenslab.dev/blog/${post.slug}`);
  }
  for (const slug of ["missing", "__proto__", "../product"]) {
    let failure: unknown;
    try {
      await (load as (input: { params: { slug: string } }) => unknown)({ params: { slug } });
    } catch (error) {
      failure = error;
    }
    assert.ok(router.isNotFound(failure), "Unknown articles must return a real router 404");
  }
  const missingHead = (
    article.Route.options.head as (input: { loaderData: undefined }) => {
      meta: Record<string, string>[];
    }
  )({ loaderData: undefined });
  assert.ok(missingHead.meta.some((item) => item.name === "robots" && item.content === "noindex"));
  const missing = render(article.ArticleNotFound);
  assert.ok(missing.includes("That article isn’t here."));
  assert.ok(missing.includes('href="/blog"'));
  const releaseHtml = render(changelog.ChangelogPage);
  assert.ok(releaseHtml.includes('id="release-c079f4f"'));
  assert.ok(releaseHtml.includes('id="release-6948a8f"'));
  assert.ok(!releaseHtml.includes("Lightroom parity achieved"));
  console.log("PUBLIC_CONTENT_OK");
}

type FotoArticleResult = NonNullable<ReturnType<typeof findFotoArticle>>;
