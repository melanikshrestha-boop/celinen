import { describe, expect, test } from "bun:test";
import { PHOTO_ID_MAX_LENGTH } from "../src/lib/photo-identity";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  defaultStringifySearch,
} from "@tanstack/react-router";
import {
  isWorkbenchRoute,
  studioWorkbenchBinding,
  workbenchTab,
  WORKBENCH_PRIMARY_TOOLS,
} from "../src/lib/workbench";
import {
  canonicalShootBinding,
  deliveryBoundaryBinding,
  developWorkspaceHref,
  explicitWorkspaceBinding,
  legacyWorkbenchRedirect,
  parseShootKey,
  projectScope,
  resolveWorkspaceBinding,
  scopeToolHref,
  shootKeyForBinding,
  shootRoute,
  shootWorkspaceHref,
  SHOOT_WORKFLOW_TABS,
  tabProjectScope,
} from "../src/lib/workbench-projects";

const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
describe("delivery editor boundary is not weakened by remembered workspace context", () => {
  const working = { kind: "ready" as const, projectId: a };
  const focused = {
    ...working,
    deliveryFocus: { frameId: "frame/1", versionId: "v3", handoffId: b },
  };
  test("warm same-project Develop navigation fences a delivery reference without rebinding the controller", () => {
    const href = developWorkspaceHref(focused);
    const active = resolveWorkspaceBinding(href, working, true);
    expect(active).toBe(working);
    expect(deliveryBoundaryBinding(href, active, true)).toEqual(focused);
    expect(active).toEqual(working);
  });
  test("an explicit older URL is fenced as requested without rewinding the remembered revision", () => {
    const earlier = { ...focused, deliveryFocus: { ...focused.deliveryFocus, versionId: "v1" } };
    const href = developWorkspaceHref(earlier);
    const active = resolveWorkspaceBinding(href, focused, true);
    expect(active).toBe(focused);
    expect(deliveryBoundaryBinding(href, active, true)).toEqual(earlier);
    expect(active.deliveryFocus.versionId).toBe("v3");
  });
  test("tools with no explicit version retain the remembered fence; ordinary work remains unchanged", () => {
    for (const href of ["/earnings", developWorkspaceHref(working)]) {
      expect(deliveryBoundaryBinding(href, focused, true)).toBe(focused);
      expect(deliveryBoundaryBinding(href, working, true)).toBe(working);
    }
  });
  test("malformed, conflicting and unavailable explicit references never inherit a usable working controller", () => {
    for (const href of [
      `/shoots/project%3A${a}/develop?deliveryVersion=v1`,
      `/shoots/project%3A${a}/develop?deliveryFrame=f&deliveryFrame=g&deliveryVersion=v1`,
      `/shoots/project%3A${a}/develop?project=${b}&deliveryFrame=f&deliveryVersion=v1`,
    ])
      expect(deliveryBoundaryBinding(href, working, true).kind).toBe("blocked");
    expect(deliveryBoundaryBinding(developWorkspaceHref(focused), working, false).kind).toBe(
      "blocked",
    );
    const blocked = { kind: "blocked" as const, reason: "Account context unavailable" };
    expect(deliveryBoundaryBinding(developWorkspaceHref(focused), blocked, true)).toBe(blocked);
  });
});
describe("one canonical Develop entry", () => {
  test.each([1994, 2000, PHOTO_ID_MAX_LENGTH])(
    "%i-character existing frame IDs survive the prefixed working-edit link exactly",
    (length) => {
      const suffix = "?source=original&v=1/東京";
      const frameId = `${"f".repeat(length - suffix.length)}${suffix}`;
      const binding = { kind: "ready" as const, projectId: a };
      const photoId = `studio:${frameId}`;
      const href = developWorkspaceHref(binding, photoId);
      const url = new URL(href, "https://foto.invalid");
      expect(url.searchParams.get("photo")).toBe(photoId);
      expect([...url.searchParams.keys()]).toEqual(["photo"]);
      expect(canonicalShootBinding(href, true)).toEqual(binding);
      expect(shootRoute(href)).toEqual({ key: `project:${a}`, tab: "develop" });
    },
  );
  test("Develop ID bounds include only the additive Studio prefix", () => {
    const binding = { kind: "ready" as const, projectId: a };
    expect(() =>
      developWorkspaceHref(binding, `studio:${"f".repeat(PHOTO_ID_MAX_LENGTH + 1)}`),
    ).toThrow("photo reference is invalid");
  });
  test("the maximum legacy frame survives canonical delivery routing without widening versions", () => {
    const binding = {
      kind: "ready" as const,
      projectId: a,
      deliveryFocus: { frameId: "f".repeat(PHOTO_ID_MAX_LENGTH), versionId: "v/2", handoffId: b },
    };
    const href = developWorkspaceHref(binding, `studio:${binding.deliveryFocus.frameId}`);
    expect(canonicalShootBinding(href, true)).toEqual(binding);
    for (const deliveryFocus of [
      { ...binding.deliveryFocus, frameId: "f".repeat(PHOTO_ID_MAX_LENGTH + 1) },
      { ...binding.deliveryFocus, versionId: "v".repeat(2001) },
    ]) {
      const query = defaultStringifySearch({
        project: a,
        deliveryFrame: deliveryFocus.frameId,
        deliveryVersion: deliveryFocus.versionId,
      });
      expect(
        canonicalShootBinding(shootWorkspaceHref(`project:${a}`, "develop", query), true)?.kind,
      ).toBe("blocked");
    }
  });
  test("Studio handoff keeps the exact shoot and photo identity", () => {
    const binding = { kind: "ready" as const, projectId: null, shootId: a };
    const href = developWorkspaceHref(binding, "studio:frame/with spaces");
    expect(shootRoute(href)).toEqual({ key: a, tab: "develop" });
    expect(canonicalShootBinding(href, true)).toEqual(binding);
    expect(new URL(href, "https://foto.invalid").searchParams.get("photo")).toBe(
      "studio:frame/with spaces",
    );
  });
  test("project delivery frame, revision and handoff are not dropped or coerced", () => {
    const binding = {
      kind: "ready" as const,
      projectId: a,
      deliveryFocus: { frameId: "123", versionId: "v/2", handoffId: b },
    };
    const href = developWorkspaceHref(binding, "studio:123");
    expect(canonicalShootBinding(href, true)).toEqual(binding);
    expect(shootRoute(href)?.key).toBe(`project:${a}`);
    expect(canonicalShootBinding(href, false)?.kind).toBe("blocked");
  });
  test("unbound legacy Studio remains its own library and blocked bindings never fall back", () => {
    expect(developWorkspaceHref({ kind: "ready", projectId: null })).toBe("/shoots/legacy/develop");
    expect(() => developWorkspaceHref({ kind: "blocked", reason: "Wrong source" })).toThrow(
      "Wrong source",
    );
    expect(() =>
      developWorkspaceHref({ kind: "ready", projectId: null, shootId: "bad" }),
    ).toThrow();
  });
});
describe("canonical shoot routing preserves storage identity", () => {
  test("exact primary labels/order and six tabs", () => {
    expect(WORKBENCH_PRIMARY_TOOLS.map((row) => [row.path, row.label])).toEqual([
      ["/tonight", "Tonight"],
      ["/shoots", "Shoots"],
      ["/clients", "Clients"],
      ["/library", "Library"],
      ["/deliver", "Deliver"],
      ["/earnings", "Earnings"],
    ]);
    expect(SHOOT_WORKFLOW_TABS).toEqual([
      "overview",
      "cull",
      "develop",
      "gallery",
      "social",
      "smart-file",
    ]);
  });
  for (const key of [a, b, "legacy", `project:${a}`])
    for (const tab of SHOOT_WORKFLOW_TABS) {
      test(`${key}/${tab} keeps exact library and tab identity`, () => {
        const href = shootWorkspaceHref(key, tab),
          parsed = parseShootKey(key)!;
        expect(shootRoute(href)).toEqual({ key, tab });
        const binding = explicitWorkspaceBinding(href, true)!;
        expect(binding).toEqual(
          parsed.kind === "shoot"
            ? { kind: "ready", projectId: null, shootId: parsed.id }
            : { kind: "ready", projectId: parsed.id },
        );
        expect(shootKeyForBinding(binding)).toBe(key);
        expect(workbenchTab(href)?.path).toBe(href);
        expect(tabProjectScope(href)).toBe(parsed.id === "legacy" ? "current" : parsed.id);
        expect(isWorkbenchRoute(["__root__", "/shoots", "/shoots/$id", `/shoots/$id/${tab}`])).toBe(
          true,
        );
        expect(scopeToolHref(href, { kind: "ready", projectId: null, shootId: b })).toBe(href);
      });
    }
  test("invalid keys and conflicting path/query references fail closed", () => {
    for (const key of [
      "",
      "project:legacy",
      "../private",
      "not-an-id",
      `project:${a}/extra`,
      "%00",
    ]) {
      expect(parseShootKey(key)).toBeNull();
      expect(() => shootWorkspaceHref(key)).toThrow();
    }
    for (const href of [
      `/shoots/bad/develop`,
      `/shoots/%ZZ/cull`,
      `/shoots/${a}/cull?shoot=${b}`,
      `/shoots/${a}/develop?shoot=${a}&shoot=${a}`,
      `/shoots/${a}/cull?workspaceProject=${a}`,
      `/shoots/${a}/cull?deliveryFrame=f&deliveryVersion=v`,
      `/shoots/project%3A${a}/develop?shoot=${a}`,
      `/shoots/project%3A${a}/cull?project=${b}`,
      `/shoots/project%3A${a}/cull?project=${a}&workspaceProject=${a}`,
      `/shoots/project%3A${a}/cull?workspaceFrame=f`,
      `/shoots/project%3A${a}/cull?workspaceFrame=f&workspaceFrame=g&workspaceVersion=v`,
    ]) {
      expect(canonicalShootBinding(href, true)?.kind).toBe("blocked");
      expect(
        projectScope(
          resolveWorkspaceBinding(href, { kind: "ready", projectId: null, shootId: b }, true),
        ),
      ).toBe("unavailable");
    }
  });
  test("local projects stay unavailable to cloud accounts", () => {
    expect(canonicalShootBinding(shootWorkspaceHref(`project:${a}`, "develop"), false)?.kind).toBe(
      "blocked",
    );
    expect(canonicalShootBinding(shootWorkspaceHref(a, "develop"), false)?.kind).toBe("ready");
  });
  test("handoff frame identifiers are strings and exact revision survives every tab", () => {
    const query = defaultStringifySearch({
      workspaceProject: a,
      workspaceFrame: "123",
      workspaceVersion: "v/2",
      workspaceHandoff: b,
      arbitrary: "kept",
    });
    for (const tab of SHOOT_WORKFLOW_TABS)
      expect(canonicalShootBinding(shootWorkspaceHref(`project:${a}`, tab, query), true)).toEqual({
        kind: "ready",
        projectId: a,
        deliveryFocus: { frameId: "123", versionId: "v/2", handoffId: b },
      });
    expect(
      canonicalShootBinding(`/shoots/project%3A${a}/cull?deliveryFrame=123&deliveryVersion=v`, true)
        ?.kind,
    ).toBe("blocked");
  });
  test("background tabs never rewind a remembered revision; explicit Cull may change it", () => {
    const old = studioWorkbenchBinding(
      `/studio?project=${a}&deliveryFrame=f&deliveryVersion=v1`,
      true,
    );
    expect(
      resolveWorkspaceBinding(shootWorkspaceHref(`project:${a}`, "develop"), old, true),
    ).toEqual(old);
    expect(
      resolveWorkspaceBinding(
        shootWorkspaceHref(`project:${a}`, "cull", "?deliveryFrame=f&deliveryVersion=v2"),
        old,
        true,
      ),
    ).toEqual({ kind: "ready", projectId: a, deliveryFocus: { frameId: "f", versionId: "v2" } });
  });
  test("canonical primary destinations do not inherit another shoot", () => {
    for (const path of ["/tonight", "/shoots", "/clients", "/library", "/money", "/earnings"])
      expect(scopeToolHref(path, { kind: "ready", projectId: a })).toBe(path);
    expect(canonicalShootBinding("/shoots", true)).toBeNull();
    expect(shootRoute("/shoots/x/not-a-tab")).toBeNull();
    expect(workbenchTab(`${shootWorkspaceHref(a, "develop")}?view=fit#histogram`)?.href).toBe(
      `${shootWorkspaceHref(a, "develop")}?view=fit#histogram`,
    );
    for (const path of ["/tonight", "/shoots", "/library", "/deliver", "/money", "/earnings"])
      expect(workbenchTab(`${path}#saved`)?.href).toBe(`${path}#saved`);
  });
});
describe("legacy redirects", () => {
  for (const [old, next] of [
    ["jobs", "shoots"],
    ["money", "earnings"],
    ["outbound", "deliver"],
  ])
    test(`${old} preserves bookmarks and query data`, () => {
      expect(legacyWorkbenchRedirect(`/${old}?shoot=${a}&ref=a%2Fb#saved`, null, true)).toEqual({
        href: `/${next}?shoot=${a}&ref=a%2Fb#saved`,
      });
    });
  test("Clients remains its dedicated CRM route instead of redirecting to Shoots", () => {
    expect(legacyWorkbenchRedirect(`/clients?shoot=${a}&ref=a%2Fb#saved`, null, true)).toBeNull();
    expect(workbenchTab("/clients")?.path).toBe("/clients");
  });
  test("unbound Develop opens Library and remembered source opens exactly that Develop", () => {
    expect(legacyWorkbenchRedirect("/develop?view=grid#saved", null, true)).toEqual({
      href: "/library?view=grid#saved",
    });
    expect(
      legacyWorkbenchRedirect("/develop", { kind: "ready", projectId: null, shootId: a }, true),
    ).toEqual({ href: shootWorkspaceHref(a, "develop") });
    expect(legacyWorkbenchRedirect("/develop", { kind: "ready", projectId: a }, true)).toEqual({
      href: shootWorkspaceHref(`project:${a}`, "develop"),
    });
  });
  test("explicit source wins over remembered source and duplicate refs never fall back", () => {
    expect(
      legacyWorkbenchRedirect(
        `/develop?shoot=${b}&ref=x#saved`,
        { kind: "ready", projectId: null, shootId: a },
        true,
      ),
    ).toEqual({ href: `${shootWorkspaceHref(b, "develop")}?shoot=${b}&ref=x#saved` });
    for (const href of [
      `/develop?shoot=bad`,
      `/develop?shoot=${a}&shoot=${b}`,
      `/develop?project=${a}&workspaceProject=${b}`,
      `/develop?workspaceProject=${a}&workspaceFrame=f`,
    ])
      expect(
        legacyWorkbenchRedirect(href, { kind: "ready", projectId: null, shootId: a }, true),
      ).toHaveProperty("blocked");
  });
  test("both old project-reference formats and remembered delivery revision survive", () => {
    for (const query of [
      `?project=${a}&deliveryFrame=f&deliveryVersion=v`,
      `?workspaceProject=${a}&workspaceFrame=f&workspaceVersion=v`,
    ]) {
      const result = legacyWorkbenchRedirect(`/develop${query}`, null, true)!;
      expect(result).toEqual({ href: shootWorkspaceHref(`project:${a}`, "develop", query) });
      if ("href" in result)
        expect(canonicalShootBinding(result.href, true)).toEqual({
          kind: "ready",
          projectId: a,
          deliveryFocus: { frameId: "f", versionId: "v" },
        });
    }
    const result = legacyWorkbenchRedirect(
      "/develop?ref=keep",
      {
        kind: "ready",
        projectId: a,
        deliveryFocus: { frameId: "123", versionId: "v/2", handoffId: b },
      },
      true,
    )!;
    expect(result).toHaveProperty("href");
    if ("href" in result)
      expect(canonicalShootBinding(result.href, true)).toEqual({
        kind: "ready",
        projectId: a,
        deliveryFocus: { frameId: "123", versionId: "v/2", handoffId: b },
      });
    expect(
      legacyWorkbenchRedirect("/develop", { kind: "ready", projectId: a }, false),
    ).toHaveProperty("blocked");
  });
});
test("real TanStack router resolves six nested paths with encoded project keys and search intact", async () => {
  const root = createRootRoute(),
    shoots = createRoute({ getParentRoute: () => root, path: "/shoots" });
  const shoot = createRoute({ getParentRoute: () => shoots, path: "$id" });
  const tabs = SHOOT_WORKFLOW_TABS.map((tab) =>
    createRoute({ getParentRoute: () => shoot, path: tab === "overview" ? "/" : tab }),
  );
  const tree = root.addChildren([shoots.addChildren([shoot.addChildren(tabs)])]);
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: [shootWorkspaceHref(a)] }),
  });
  await router.load();
  for (const tab of SHOOT_WORKFLOW_TABS) {
    const href = shootWorkspaceHref(`project:${a}`, tab, "?workspaceFrame=f&workspaceVersion=v");
    await router.navigate({ href });
    expect(router.state.matches.at(-1)?.status).toBe("success");
    expect(router.state.matches.at(-1)?.params).toMatchObject({ id: `project:${a}` });
    expect(canonicalShootBinding(router.state.location.href, true)).toEqual({
      kind: "ready",
      projectId: a,
      deliveryFocus: { frameId: "f", versionId: "v" },
    });
  }
});
