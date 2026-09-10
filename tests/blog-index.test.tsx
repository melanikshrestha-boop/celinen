import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BLOG_CATEGORIES, fotoArticles } from "../src/lib/public-content";
import { PRO_STEPS } from "../src/lib/published-plans";

mock.module("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children?: React.ReactNode;
  }) => {
    let path = to;
    for (const [key, value] of Object.entries(params ?? {}))
      path = path.replace(`$${key}`, encodeURIComponent(value));
    return createElement("a", { ...props, href: path }, children);
  },
}));

const { BlogIndex } = await import("../src/components/marketing/BlogIndex");

test("blog is a category index with example photography posts", () => {
  const html = renderToStaticMarkup(<BlogIndex />);
  expect(html).toContain("The ");
  expect(html).toContain("foto");
  expect(html).toContain("blog");
  for (const category of BLOG_CATEGORIES) expect(html).toContain(category);
  expect(fotoArticles).toHaveLength(3);
  expect(html).toContain('href="/blog/lightroom-vs-capture-one-2026"');
  expect(html).toContain("Lightroom vs Capture One in 2026");
  expect(html).toContain("How to send a client gallery the same night");
  expect(html).toContain("Aftershoot, Imagen, and picking the frames yourself");
  expect(html).toContain("/images/blog/lightroom-capture-one.jpg");
  expect(html).not.toContain("viral");
  expect(html).not.toContain("YouTube Automation");
  expect(html).toContain("Honest comparisons, guides, and insights for photographers.");
  expect(html).not.toContain("video creators");
});

test("home pricing uses published Pro amounts", () => {
  expect(PRO_STEPS.map((step) => [step.yearly, step.monthly])).toEqual([
    [16, 20],
    [48, 60],
    [160, 200],
  ]);
});
