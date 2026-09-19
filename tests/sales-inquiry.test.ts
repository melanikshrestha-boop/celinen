import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SALES_HEADCOUNT, SALES_PRODUCTS, validateSalesInquiry } from "../src/lib/sales-inquiry";

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
mock.module("@/components/account/AccountProvider", () => ({
  useAccount: () => undefined,
}));
const { ContactSalesPage } = await import("../src/routes/contact-sales");

const valid = {
  firstName: "Maya",
  lastName: "Chen",
  email: "maya@studio.test",
  company: "North Light",
  product: "Celinen",
  headcount: "11–50",
  needs: "Same-night galleries for two studios.",
};

test("sales inquiry requires work email, company, product, size, and need", () => {
  expect(validateSalesInquiry(valid)).toBeNull();
  expect(validateSalesInquiry({ ...valid, email: "nope" })).toBe("Work email is required.");
  expect(validateSalesInquiry({ ...valid, company: " " })).toBe("Company name is required.");
  expect(validateSalesInquiry({ ...valid, product: "Latch" })).toBe("Pick a product.");
  expect(validateSalesInquiry({ ...valid, headcount: "huge" })).toBe("Pick a company size.");
  expect(validateSalesInquiry({ ...valid, needs: "" })).toBe("Say what you need.");
  expect(SALES_PRODUCTS).toContain("Celinen");
  expect(SALES_PRODUCTS).toContain("Heavenly");
  expect(SALES_PRODUCTS).not.toContain("Latch");
  expect(SALES_HEADCOUNT.length).toBeGreaterThanOrEqual(4);
});

test("public sales POST stores a valid inquiry", async () => {
  const { handleSalesPost, salesLogPath } = await import("../src/routes/api/public/sales");
  const dir = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  process.env.LENSLAB_SALES_LOG = path.join(dir.tmpdir(), `lenslab-sales-${Date.now()}.jsonl`);
  const response = await handleSalesPost(
    new Request("https://lenslab.dev/api/public/sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
    }),
  );
  expect(response.status).toBe(200);
  const saved = await fs.readFile(salesLogPath(), "utf8");
  expect(saved).toContain("maya@studio.test");
  expect(saved).not.toContain("Latch");
  await fs.unlink(salesLogPath());
});

test("contact-sales page is a LensLab sales form", () => {
  const html = renderToStaticMarkup(createElement(ContactSalesPage));
  expect(html).toContain('id="contact-sales"');
  expect(html).toContain("First name");
  expect(html).toContain("Work email");
  expect(html).toContain("Contact sales");
  expect(html).not.toContain("Latch");
  expect(html).not.toContain("Career");
  expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
});
