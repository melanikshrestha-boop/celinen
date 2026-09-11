import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { publicEntry } from "../src/lib/public-entry";
import { isWorkbenchRoute, safeSignInPath } from "../src/lib/workbench";
import { NewGalleryFields } from "../src/components/delivery/NewGalleryFields";

describe("public entry without replacing the remembered workspace", () => {
  test("both real and local signed-in accounts continue straight to the workspace", () => {
    for (const local of [true, false])
      expect(publicEntry("in", local)).toEqual({
        to: "/dashboard",
        search: {},
        label: "Dashboard",
      });
  });
  test("local mode alone does not bypass a closed workspace", () => {
    expect(publicEntry("out", true)).toEqual({
      to: "/auth",
      search: { next: "/dashboard", mode: "signup" },
      label: "Open local workspace",
    });
  });
  test("new and unresolved visitors enter through auth, not a private route", () => {
    for (const status of [undefined, "loading", "out"] as const) {
      expect(publicEntry(status).to).toBe("/auth");
      expect(publicEntry(status).label).toBe("Get started");
      expect(publicEntry(status).search).toEqual({ next: "/dashboard", mode: "signup" });
    }
  });
  test("the public homepage and auth stay outside the private workbench", () => {
    expect(isWorkbenchRoute(["__root__", "/"])).toBe(false);
    expect(isWorkbenchRoute(["__root__", "/auth"])).toBe(false);
    expect(isWorkbenchRoute(["__root__", "/workspace"])).toBe(true);
    expect(isWorkbenchRoute(["__root__", "/dashboard"])).toBe(false);
    expect(safeSignInPath("/deliver?workflow=1")).toBe("/deliver?workflow=1");
    expect(safeSignInPath("https://untrusted.example")).toBe("/dashboard");
  });
});

describe("compact new gallery form", () => {
  const fields = () =>
    renderToStaticMarkup(
      <NewGalleryFields
        defaultDate="2026-10-06"
        earliestDate="2026-09-07"
        latestDate="2027-09-06"
      />,
    );
  test("only the two required identity fields appear before the disclosure", () => {
    const top = fields().split("<details")[0]!;
    expect(top.match(/<input /g)).toHaveLength(2);
    expect(top).toContain('name="title"');
    expect(top).toContain('name="client"');
    expect(top.match(/required=""/g)).toHaveLength(2);
  });
  test("collapsed options stay mounted with existing defaults and limits", () => {
    const html = fields();
    expect(html).not.toContain('open=""');
    expect(html).toContain('name="limit"');
    expect(html).toContain('value="30"');
    expect(html).toContain('max="3000"');
    expect(html).toContain('name="expires"');
    expect(html).toContain('value="2026-10-06"');
    expect(html).toContain('min="2026-09-07"');
    expect(html).toContain('max="2027-09-06"');
    expect(html).toContain('name="message"');
    expect(html).toContain('maxLength="2000"');
  });
  test("invalid collapsed options expose themselves for browser validation", () => {
    const tree = NewGalleryFields({
      defaultDate: "2026-10-06",
      earliestDate: "2026-09-07",
      latestDate: "2027-09-06",
    });
    const details = tree.props.children.find((child: { type: string }) => child.type === "details");
    const target = { open: false };
    details.props.onInvalidCapture({ currentTarget: target });
    expect(target.open).toBe(true);
  });
});
