import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { defaultStringifySearch } from "@tanstack/react-router";
import {
  canonicalShootBinding,
  developWorkspaceHref,
  explicitWorkspaceBinding,
  shootRoute,
} from "../src/lib/workbench-projects";
import { canPersistStudioSession } from "../src/lib/studio/session";
import { isDashboardAppRoute, isWorkbenchRoute } from "../src/lib/workbench";
import { PHOTO_ID_MAX_LENGTH } from "../src/lib/photo-identity";

// Like the account-boundary/warm-navigation fixtures, execute the actual route
// and controller functions with instance-local hooks and I/O. No module mocks,
// Auth, browser database, real import, native service, or customer files.
type Element = { type: string; props: Record<string, unknown> };
type Namespace = { scope: string; libraryId: string };
const studioSource = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const shootSource = readFileSync(
  new URL("../src/routes/-shoot-workspace.tsx", import.meta.url),
  "utf8",
);
const transpiler = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "jsx" } },
});
function between(source: string, start: string, end: string) {
  const from = source.indexOf(start),
    to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing component boundary: ${start}`);
  return source.slice(from, to).replace(/^export /gm, "");
}
function execute(code: string, context: Record<string, unknown>, result: string) {
  return new Function(
    ...Object.keys(context),
    transpiler.transformSync(`${code}\nreturn ${result};`),
  )(...Object.values(context));
}
const jsx = (type: string, props: Element["props"] | null, ...children: unknown[]): Element => ({
  type,
  props: { ...props, children },
});
function studioRoute(
  scope: string | null,
  search: Record<string, string> = {},
  options: { workbench?: boolean; href?: string; local?: boolean } = {},
) {
  const href = options.href ?? `/studio${defaultStringifySearch(search)}`;
  return execute(
    between(studioSource, "function StudioRoute()", "\ntype Filter"),
    {
      useAccount: () => ({ scope }),
      useWorkbench: () => (options.workbench ? { storageScope: scope } : null),
      useLocation: ({ select }: { select: (location: { href: string }) => unknown }) =>
        select({ href }),
      Route: { useSearch: () => search },
      useState: () => [true, () => {}],
      useEffect: () => {},
      explicitWorkspaceBinding,
      isLocalSingleUserMode: options.local ?? false,
      Studio: "Studio",
      jsx,
    },
    "StudioRoute()",
  ) as Element | null;
}
function studioNamespaces(props: Element["props"]) {
  const initialization = between(
    studioSource,
    "export function Studio({",
    "  const unanalyzedIds = useRef",
  );
  return execute(
    `${initialization}\nreturn {repository, importSession};\n}`,
    {
      useWorkbench: () => null,
      useDashboard: () => true,
      useNavigate: () => () => {},
      useState: (input: unknown) => [typeof input === "function" ? input() : input],
      createShootRepository: (options: Namespace) => options,
      createCullShootView: () => ({}),
      getDevelopImportSession: (options: Namespace) => options,
      props,
    },
    "Studio(props)",
  ) as { repository: Namespace; importSession: Namespace };
}
async function openDevelop(props: Element["props"], selectedPhotoId: string) {
  let navigated = "";
  const opened = await execute(
    between(studioSource, "  async function openDevelop(", "  canonicalOpenRef.current"),
    {
      projectId: props.projectId,
      shootId: props.shootId,
      deliveryFocus: props.deliveryFocus,
      canPersistStudioSession,
      sessionStatusRef: { current: "ready" },
      proposalRef: { current: null },
      repository: { flush: async () => true },
      mountedRef: { current: true },
      latestSelectedIdRef: { current: "synthetic-studio-shot" },
      canonicalView: {
        photoId: (shotId: string) => (shotId === "synthetic-studio-shot" ? selectedPhotoId : null),
      },
      developWorkspaceHref,
      workbench: null,
      navigate: async ({ href }: { href: string }) => {
        navigated = href;
      },
      setSyncNote: (message: string) => {
        throw new Error(message);
      },
      pauseSaving: (error: Error) => {
        throw error;
      },
    },
    "openDevelop()",
  );
  expect(opened).toBe(true);
  return navigated;
}
function canonicalDevelop(scope: string, href: string, local = false) {
  return execute(
    between(shootSource, "function useShootRoute()", "\nexport function ShootHubRoute") +
      between(
        shootSource,
        "export function ShootDevelopRoute()",
        "\nexport function ShootGalleryRoute",
      ),
    {
      useAccount: () => ({ scope }),
      useWorkbench: () => ({ storageScope: scope }),
      useLocation: ({ select }: { select: (location: { href: string }) => unknown }) =>
        select({ href }),
      canonicalShootBinding,
      shootRoute,
      isLocalSingleUserMode: local,
      DevelopPage: "DevelopPage",
      jsx,
    },
    "ShootDevelopRoute()",
  ) as Element;
}

describe("dashboard Studio imports retain canonical Develop ownership", () => {
  const shoot = "11111111-1111-4111-8111-111111111111";
  test.each([
    ["owner-a", undefined],
    ["owner-b", undefined],
    ["owner-a", shoot],
    ["owner-b", shoot],
  ] as const)("%s Studio and Develop use the same namespace for shoot %s", async (scope, id) => {
    expect(isDashboardAppRoute(["__root__", "/studio"], "/studio")).toBe(true);
    expect(isWorkbenchRoute(["__root__", "/studio"])).toBe(false);
    const studio = studioRoute(scope, id ? { shoot: id } : {});
    expect(studio?.type).toBe("Studio");
    const namespaces = studioNamespaces(studio!.props);
    const href = await openDevelop(studio!.props, "synthetic-selected-photo");
    expect(href).toBe(`/shoots/${id ?? "legacy"}/develop?photo=synthetic-selected-photo`);
    const target = canonicalDevelop(scope, href);
    expect(target.type).toBe("DevelopPage");
    expect(target.props.scope).toBe(scope);
    expect(target.props.shootId).toBe(id ?? "legacy");
    expect(namespaces.repository).toEqual({ scope, libraryId: `shoot:${id ?? "legacy"}` });
    expect(namespaces.importSession).toEqual(namespaces.repository);
  });

  test("an account change replaces the Studio controller key, while the same owner stays stable", () => {
    const first = studioRoute("owner-a", { shoot }),
      same = studioRoute("owner-a", { shoot }),
      other = studioRoute("owner-b", { shoot });
    expect(first?.props.key).toBe(same?.props.key);
    expect(first?.props.key).not.toBe(other?.props.key);
    expect(other?.props.storageScope).toBe("owner-b");
  });

  test("an unavailable identity never instantiates the device-local Studio fallback", () => {
    expect(studioRoute(null)?.type).not.toBe("Studio");
  });

  test("the canonical Workbench still owns its persistent Studio controller", () => {
    expect(studioRoute("owner-a", { shoot }, { workbench: true })).toBeNull();
  });

  test.each([
    `/studio?shoot=${shoot}&shoot=${shoot}`,
    `/studio?shoot=${shoot}&project=${shoot}`,
    "/studio?shoot=invalid",
  ])("ambiguous or invalid source references do not instantiate Studio: %s", (href) => {
    expect(studioRoute("owner-a", {}, { href })?.type).not.toBe("Studio");
  });

  test("named projects remain unavailable in the hosted application", () => {
    expect(studioRoute("owner-a", { project: shoot })?.type).not.toBe("Studio");
  });

  test("local project handoffs preserve full-length frame, version, and selected-source identities", async () => {
    const scope = "owner-a";
    const deliveryFocus = {
      frameId: "folder/α photo.jpg:".repeat(300).slice(0, PHOTO_ID_MAX_LENGTH),
      versionId: "version/ +".repeat(200),
      handoffId: "22222222-2222-4222-8222-222222222222",
    };
    const search = {
      project: shoot,
      deliveryFrame: deliveryFocus.frameId,
      deliveryVersion: deliveryFocus.versionId,
      deliveryHandoff: deliveryFocus.handoffId,
    };
    const original = JSON.stringify(search);
    const studio = studioRoute(scope, search, { local: true });
    expect(studio?.type).toBe("Studio");
    expect(deliveryFocus.frameId).toHaveLength(PHOTO_ID_MAX_LENGTH);
    expect(deliveryFocus.versionId).toHaveLength(2000);
    expect(studio?.props).toMatchObject({ storageScope: scope, projectId: shoot, deliveryFocus });
    const namespaces = studioNamespaces(studio!.props);
    expect(namespaces.repository).toEqual({ scope, libraryId: `project:${shoot}` });
    expect(namespaces.importSession).toEqual(namespaces.repository);
    const selectedPhoto = `studio:${deliveryFocus.frameId}`;
    const href = await openDevelop(studio!.props, selectedPhoto);
    expect(shootRoute(href)).toEqual({ key: `project:${shoot}`, tab: "develop" });
    expect(new URL(href, "https://workspace.invalid").searchParams.get("photo")).toBe(
      selectedPhoto,
    );
    const target = canonicalDevelop(scope, href, true);
    expect(target.type).toBe("DevelopPage");
    expect(target.props).toMatchObject({ scope, projectId: shoot, deliveryFocus });
    expect(target.props).not.toHaveProperty("shootId");
    expect(
      studioRoute(scope, { ...search, deliveryVersion: "next-version" }, { local: true })?.props
        .key,
    ).not.toBe(studio?.props.key);
    expect(JSON.stringify(search)).toBe(original);
  });
});
