import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MouseEvent } from "react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import {
  LibraryRecents,
  NewShootAction,
  PrimaryNavigation,
} from "../src/components/workbench/PrimaryNavigation";
import {
  FOTO_PRIMARY_NAV,
  followNavigation,
  primaryNavigationPath,
} from "../src/components/workbench/primary-navigation";

describe("FOTO primary navigation", () => {
  test("seven destinations include Home plus a dedicated CRM, no editor or duplicate create action", () => {
    expect(FOTO_PRIMARY_NAV.map(({ label, href }) => [label, href])).toEqual([
      ["Home", "/workspace"],
      ["Tonight", "/tonight"],
      ["Shoots", "/shoots"],
      ["Clients", "/clients"],
      ["Library", "/library"],
      ["Deliver", "/deliver"],
      ["Earnings", "/earnings"],
    ]);
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PrimaryNavigation pathname="/shoots/legacy/develop" open={() => {}} />
      </TooltipProvider>,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Shoots" aria-current="page"');
    expect(html.match(/href="\/clients"/g)).toHaveLength(1);
    for (const legacy of ["Jobs", "New project", "Outbound", "Money", ">Develop<"])
      expect(html).not.toContain(legacy);
  });
  test("all shoot modules belong to Shoots, unrelated paths are not selected", () => {
    for (let n = 0; n < 1000; n++) {
      const id = `eeaf3000-1111-4222-8333-${String(n).padStart(12, "0")}`;
      for (const module of ["", "/cull", "/develop", "/gallery", "/social", "/smart-file"])
        expect(primaryNavigationPath(`/shoots/${id}${module}`)).toBe("/shoots");
    }
    expect(primaryNavigationPath("/shoots/")).toBe("/shoots");
    expect(primaryNavigationPath("/SHOOTS/legacy/CULL")).toBe("/shoots");
    expect(primaryNavigationPath("/LIBRARY/")).toBe("/library");
    expect(primaryNavigationPath("/CLIENTS/")).toBe("/clients");
    expect(primaryNavigationPath("/workspace")).toBe("/workspace");
    expect(primaryNavigationPath("/workspace", "?shoot=legacy")).toBeNull();
    expect(primaryNavigationPath("/shootstuff")).toBeNull();
    expect(primaryNavigationPath("/settings/general")).toBeNull();
  });
  test("unknown, empty, or invalid counts never become invented badges", () => {
    for (const count of [null, 0, -1, NaN, Infinity]) {
      const html = renderToStaticMarkup(
        <TooltipProvider>
          <PrimaryNavigation
            pathname="/tonight"
            counts={{ "/tonight": count, "/deliver": count }}
            open={() => {}}
          />
        </TooltipProvider>,
      );
      expect(html).not.toContain("foto-nav-count");
    }
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PrimaryNavigation
          pathname="/tonight"
          counts={{ "/tonight": 3, "/deliver": 105 }}
          open={() => {}}
        />
      </TooltipProvider>,
    );
    expect(html).toContain('aria-label="3 scheduled shoots"');
    expect(html).toContain('aria-label="105 unpublished galleries"');
    expect(html).toContain("99+");
  });
  test("recent list caps display at eight without modifying saved records", () => {
    const rows = Array.from({ length: 12 }, (_, n) => ({
      id: String(n),
      title: `Shoot ${n}`,
      href: `/shoots/${n}`,
      detail: "10 photos · Updated Sep 8",
    }));
    const before = JSON.stringify(rows);
    const html = renderToStaticMarkup(
      <LibraryRecents rows={rows} activeId="2" open={() => {}} loading={false} error="" />,
    );
    expect(html.match(/class="foto-library-row/g)).toHaveLength(8);
    expect(html).not.toContain("Shoot 8");
    expect(html).toContain('aria-current="page"');
    expect(JSON.stringify(rows)).toBe(before);
    expect(
      renderToStaticMarkup(
        <LibraryRecents rows={[]} activeId={null} open={() => {}} loading={false} error="" />,
      ),
    ).toBe("");
  });
  test("New shoot advertises loading without presenting a second create action", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <NewShootAction create={() => {}} busy />
      </TooltipProvider>,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="New Shoot" disabled=""');
    expect(html).toContain("Opening…");
  });
  test("normal clicks use guarded navigation, browser modified clicks retain their behavior", () => {
    let prevented = 0,
      opened = 0;
    const base = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => prevented++,
    };
    followNavigation(base as MouseEvent, "/shoots", () => opened++);
    expect([prevented, opened]).toEqual([1, 1]);
    for (const patch of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ])
      followNavigation({ ...base, ...patch } as MouseEvent, "/money", () => opened++);
    expect([prevented, opened]).toEqual([1, 1]);
  });
});
