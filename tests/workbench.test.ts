import { describe, expect, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  addWorkbenchTab,
  closeWorkbenchTab,
  isWorkbenchRoute,
  safeSignInPath,
  studioBindingHref,
  studioBindingKey,
  studioWorkbenchBinding,
  workbenchNavigation,
  workbenchTab,
  WORKBENCH_TOOLS,
  WORKBENCH_PRIMARY_TOOLS,
} from "../src/lib/workbench";
import { workspaceStorageKey } from "../src/lib/workspace-storage";
import {
  clearVideoReviewSession,
  commitVideoReviewSession,
  loadVideoReviewSession,
  saveVideoReviewSession,
  VIDEO_REVIEW_STORAGE_KEY,
  type VideoReviewStorage,
} from "../src/lib/video/session";

const accountA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const accountB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("chat-first workspace boundaries", () => {
  test("keeps the focused photo tool shortcuts including Develop without dropping the full catalogue", () => {
    expect(WORKBENCH_PRIMARY_TOOLS.map((tool) => tool.path)).toEqual([
      "/studio",
      "/develop",
      "/deliver",
      "/clients",
    ]);
    expect(WORKBENCH_TOOLS).toHaveLength(23);
    expect(WORKBENCH_TOOLS.some((tool) => tool.path === "/outbound")).toBe(true);
    expect(new Set(WORKBENCH_TOOLS.map((tool) => tool.path)).size).toBe(WORKBENCH_TOOLS.length);
    for (const tool of WORKBENCH_TOOLS) {
      expect(workbenchTab(tool.path)?.path).toBe(tool.path);
      expect(workbenchNavigation(`open ${tool.label}`)).toBe(tool.path);
    }
    expect(
      WORKBENCH_TOOLS.filter((tool) => tool.group === "Connections").map((tool) => tool.path),
    ).toEqual(["/mail", "/research"]);
  });
  for (const path of ["/workspace", "/shoot", ...WORKBENCH_TOOLS.map((t) => t.path)]) {
    test(`wraps private tool ${path}`, () =>
      expect(isWorkbenchRoute(["__root__", path])).toBe(true));
  }
  for (const path of [
    "/",
    "/auth",
    "/signup",
    "/pricing",
    "/ambassador",
    "/book",
    "/portal",
    "/review/$id",
    "/g/$slug",
    "/s/$token",
    "/api/chat",
    "/community",
    "/studio-impostor",
  ]) {
    test(`leaves public or unrelated route ${path} alone`, () =>
      expect(isWorkbenchRoute(["__root__", path])).toBe(false));
  }
  test("retains proofing and exact source-version search parameters", () => {
    expect(workbenchTab("/deliver?workflow=1")?.href).toBe("/deliver?workflow=1");
    const href = `/studio?project=${accountA}&deliveryFrame=frame%2F1&deliveryVersion=v2`;
    expect(workbenchTab(href)?.href).toBe(href);
    expect(workbenchTab("/deliver?workflow=true")?.href).toBe("/deliver?workflow=1");
  });
  test("rejects external, client-gallery and malformed tool URLs", () => {
    for (const href of [
      "https://example.com",
      "//example.com/studio",
      "/\\example.com",
      "/review/private",
      "/api/private",
      "/studio\n",
    ])
      expect(workbenchTab(href)).toBeNull();
  });
  test("closing a named-project tab returns to the exact legacy Studio tab", () => {
    const legacy = workbenchTab("/studio")!;
    const project = workbenchTab(`/studio?project=${accountA}`)!;
    const tabs = addWorkbenchTab(addWorkbenchTab([], legacy), project);
    expect(addWorkbenchTab(tabs, project)).toBe(tabs);
    expect(closeWorkbenchTab(tabs, project.href, project.href)).toEqual({
      tabs: [legacy],
      next: "/studio",
    });
    expect(closeWorkbenchTab([legacy], legacy.href, legacy.href)).toEqual({
      tabs: [],
      next: "/workspace",
    });
    expect(closeWorkbenchTab(tabs, legacy.href, project.href).next).toBe(project.href);
  });
  test("only explicit tool-opening language navigates", () => {
    expect(workbenchNavigation("Open the delivery.")).toBe("/deliver");
    expect(workbenchNavigation("Show client proofing")).toBe("/deliver?workflow=1");
    expect(workbenchNavigation("Go to Adobe settings")).toBe("/adobe");
    expect(workbenchNavigation("switch to chat")).toBe("/workspace");
    for (const text of [
      "send these to my client",
      "delete the gallery",
      "deliver these photos",
      "approve all",
      "Open https://example.com",
      "show keepers",
    ])
      expect(workbenchNavigation(text)).toBeNull();
  });
  test("safe sign-in defaults to chat and preserves legitimate deep links", () => {
    for (const path of [
      "",
      "//evil.test",
      "/%2fexample.com",
      "/\\evil.test",
      "/%5cevil.test",
      "/%00studio",
      "/auth?next=/auth",
      "https://evil.test",
      "/%ZZ",
    ])
      expect(safeSignInPath(path)).toBe("/workspace");
    expect(safeSignInPath("/deliver?workflow=1")).toBe("/deliver?workflow=1");
    expect(safeSignInPath("/review/client-link")).toBe("/review/client-link");
  });
});

test("real router href navigation retains proofing and exact Studio references", async () => {
  const root = createRootRoute();
  const workspace = createRoute({ getParentRoute: () => root, path: "/workspace" });
  const deliver = createRoute({
    getParentRoute: () => root,
    path: "/deliver",
    validateSearch: (search: Record<string, unknown>) => ({
      workflow: search["workflow"] === 1 || search["workflow"] === true,
    }),
  });
  const studio = createRoute({
    getParentRoute: () => root,
    path: "/studio",
    validateSearch: (search: Record<string, unknown>) => search,
  });
  const router = createRouter({
    routeTree: root.addChildren([workspace, deliver, studio]),
    history: createMemoryHistory({ initialEntries: ["/workspace"] }),
  });
  await router.load();
  await router.navigate({ href: "/deliver?workflow=1" });
  expect(router.state.location.pathname).toBe("/deliver");
  expect(workbenchTab(router.state.location.href)?.href).toBe("/deliver?workflow=1");
  await router.navigate({ href: `/studio?project=${accountA}&deliveryFrame=f&deliveryVersion=v2` });
  expect(router.state.location.pathname).toBe("/studio");
  expect(studioWorkbenchBinding(router.state.location.href, true)).toEqual({
    kind: "ready",
    projectId: accountA,
    deliveryFocus: { frameId: "f", versionId: "v2" },
  });
});

describe("exact Studio binding", () => {
  test("unavailable or malformed named projects never fall back to the legacy shoot", () => {
    expect(studioWorkbenchBinding(`/studio?project=${accountA}`, false).kind).toBe("blocked");
    for (const href of [
      "/studio?project=",
      "/studio?project=invalid",
      "/studio?deliveryFrame=f&deliveryVersion=v",
      `/studio?project=${accountA}&deliveryFrame=f`,
      `/studio?project=${accountA}&deliveryVersion=v`,
    ])
      expect(studioWorkbenchBinding(href, true).kind).toBe("blocked");
  });
  test("different revisions of the same frame get different controllers", () => {
    const first = studioWorkbenchBinding(
      `/studio?project=${accountA}&deliveryFrame=f&deliveryVersion=v1`,
      true,
    );
    const next = studioWorkbenchBinding(
      `/studio?project=${accountA}&deliveryFrame=f&deliveryVersion=v2`,
      true,
    );
    expect(studioBindingKey(first)).not.toBe(studioBindingKey(next));
    expect(studioBindingHref(next)).toBe(
      `/studio?project=${accountA}&deliveryFrame=f&deliveryVersion=v2`,
    );
  });
  test("duplicate and non-string source references fail closed", () => {
    for (const suffix of [
      `project=${accountA}&project=${accountB}`,
      `project=${accountA}&deliveryFrame=f&deliveryFrame=g&deliveryVersion=v`,
      `project=${accountA}&deliveryFrame=f&deliveryVersion=123`,
      `project=${accountA}&deliveryFrame=null&deliveryVersion=v`,
    ])
      expect(studioWorkbenchBinding(`/studio?${suffix}`, true).kind).toBe("blocked");
  });
  test("a harmless hash never leaves the previous shoot attached to a new project URL", () => {
    const href = `/studio?project=${accountB}#frame`;
    expect(workbenchTab(href)?.href).toBe(`/studio?project=${accountB}`);
    expect(studioWorkbenchBinding(href, true)).toEqual({ kind: "ready", projectId: accountB });
  });
  test("ordinary chat and Studio bind to the current account's unnamed shoot", () => {
    expect(studioWorkbenchBinding("/workspace", false)).toEqual({ kind: "ready", projectId: null });
    expect(studioBindingHref(studioWorkbenchBinding("/studio", true))).toBe("/studio");
  });
});

describe("account-scoped review storage", () => {
  test("keeps device-local names unchanged and rejects missing/invalid account scopes", () => {
    expect(workspaceStorageKey("legacy")).toBe("legacy");
    expect(workspaceStorageKey("legacy", accountA)).toBe(`legacy:account:${accountA}`);
    expect(workspaceStorageKey("legacy", accountA.toUpperCase())).toBe(
      `legacy:account:${accountA}`,
    );
    for (const scope of ["", "anonymous", "../other", "device-local:account:a"])
      expect(() => workspaceStorageKey("legacy", scope)).toThrow();
  });
  test("save and clear in account A preserve account B and device-local data", async () => {
    const rows = new Map<string, string>();
    const storage: VideoReviewStorage = {
      getItem: (key) => rows.get(key) ?? null,
      setItem: (key, value) => {
        rows.set(key, value);
      },
    };
    const draft = { clips: [], selectedId: null, filter: "all" as const, journal: [] };
    expect(saveVideoReviewSession(draft, 0, storage).ok).toBe(true);
    const legacy = rows.get(VIDEO_REVIEW_STORAGE_KEY);
    expect(loadVideoReviewSession(storage, accountA).status).toBe("empty");
    const locks: string[] = [];
    const lockManager = {
      request: async <T>(name: string, callback: () => T | Promise<T>) => {
        locks.push(name);
        return callback();
      },
    };
    expect(
      (await commitVideoReviewSession(draft, 0, { storage, lockManager, scope: accountA })).ok,
    ).toBe(true);
    expect(
      (await commitVideoReviewSession(draft, 0, { storage, lockManager, scope: accountB })).ok,
    ).toBe(true);
    const other = rows.get(workspaceStorageKey(VIDEO_REVIEW_STORAGE_KEY, accountB));
    expect((await clearVideoReviewSession({ storage, lockManager, scope: accountA })).ok).toBe(
      true,
    );
    expect(rows.get(VIDEO_REVIEW_STORAGE_KEY)).toBe(legacy);
    expect(rows.get(workspaceStorageKey(VIDEO_REVIEW_STORAGE_KEY, accountB))).toBe(other);
    expect(locks).toEqual([
      `${VIDEO_REVIEW_STORAGE_KEY}.write:account:${accountA}`,
      `${VIDEO_REVIEW_STORAGE_KEY}.write:account:${accountB}`,
      `${VIDEO_REVIEW_STORAGE_KEY}.write:account:${accountA}`,
    ]);
    expect(saveVideoReviewSession(draft, 1, storage, undefined, accountA).ok).toBe(false);
  });
});
