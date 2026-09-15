import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import {
  advanceDevelopImportJob,
  createDevelopDocument,
  type DevelopImportJob,
  type DevelopLibrary,
} from "../src/lib/develop/store";
import { isDashboardAppRoute, isPrivateAppRoute, isWorkbenchRoute } from "../src/lib/workbench";

type Session = ReturnType<typeof createDevelopImportSession>;
type Identity = { scope: string | null; status: "in" | "out"; setupComplete: boolean };
const account = (scope: string | null, setupComplete = true): Identity => ({
  scope,
  status: scope ? "in" : "out",
  setupComplete,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Execute the actual shell boundary with route/account hooks only. JSX children
 * are opaque: no Auth, browser database, remote call or customer record is opened.
 */
function boundaryFixture(sessions: Map<string, Session>) {
  const source = readFileSync(
    new URL("../src/components/workbench/Workbench.tsx", import.meta.url),
    "utf8",
  );
  const boundary = source.slice(
    source.indexOf("export function WorkbenchBoundary("),
    source.indexOf("\nfunction AccountWorkbench("),
  );
  const compiled = new Bun.Transpiler({ loader: "tsx", target: "browser" })
    .transformSync(boundary)
    .replace(/^export /m, "")
    .replace(/jsxDEV_\w+/g, "jsx");
  const sessionSource = readFileSync(
    new URL("../src/lib/develop/import-session.ts", import.meta.url),
    "utf8",
  );
  const cancellation = new Bun.Transpiler({ loader: "ts", target: "browser" })
    .transformSync(
      sessionSource.slice(
        sessionSource.indexOf("export function cancelDevelopImportsOutsideScope("),
      ),
    )
    .replace(/^export /m, "");
  const cancel = new Function(
    "sessions",
    `${cancellation}\nreturn cancelDevelopImportsOutsideScope;`,
  )(sessions) as (scope: string) => void;
  let identity = account("owner-a");
  let route = {
    matches: [{ routeId: "/shoots/$id/develop" }],
    location: { pathname: "/shoots/legacy/develop" },
  };
  const dependencies: unknown[][] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  const cancellations: string[] = [];
  const renderBoundary = new Function(
    "useAccount",
    "useRouterState",
    "useEffect",
    "cancelDevelopImportsOutsideScope",
    "isDashboardAppRoute",
    "isPrivateAppRoute",
    "isWorkbenchRoute",
    "jsx",
    "AccountSetup",
    "AppDashboard",
    "AccountWorkbench",
    `${compiled}\nreturn WorkbenchBoundary;`,
  )(
    () => identity,
    ({ select }: { select: (input: typeof route) => unknown }) => select(route),
    (effect: () => void, deps: unknown[]) => {
      const index = cursor++,
        prior = dependencies[index];
      if (!prior || deps.some((value, position) => !Object.is(value, prior[position]))) {
        dependencies[index] = deps;
        pending.push(effect);
      }
    },
    (scope: string) => {
      cancellations.push(scope);
      cancel(scope);
    },
    isDashboardAppRoute,
    isPrivateAppRoute,
    isWorkbenchRoute,
    (type: string, props: unknown) => ({ type, props }),
    "setup",
    "dashboard",
    "workbench",
  ) as (props: { children: string }) => { type: string } | string;
  return {
    cancellations,
    render(next: Identity, pathname: string) {
      identity = next;
      route = {
        matches: [{ routeId: pathname.startsWith("/shoots/") ? "/shoots/$id/develop" : pathname }],
        location: { pathname },
      };
      cursor = 0;
      const result = renderBoundary({ children: "route" });
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
      return result;
    },
  };
}

function importFixture(scope: string, hold: "preview" | "receipt" = "preview") {
  const entered = deferred(),
    release = deferred();
  let signal: AbortSignal | undefined;
  let job: DevelopImportJob | null = null;
  const library: DevelopLibrary = { photos: [], documents: {}, presets: [] };
  const session = createDevelopImportSession(
    { scope, libraryId: "shoot:synthetic-account-boundary" },
    {
      unloadTarget: null,
      withLock: async (_name, work) => {
        await work();
      },
      preparePreview: async (_file, input, ownerSignal) => {
        signal = ownerSignal;
        if (hold === "preview") {
          entered.resolve();
          await release.promise;
        }
        return { ...input, width: 1, height: 1, previewBlob: new Blob(["synthetic preview"]) };
      },
      store: {
        loadLibrary: async () => library,
        readImportJob: async () => job,
        saveImportJob: async (input, revision) => {
          job = advanceDevelopImportJob(job, input, revision);
          return job;
        },
        addPhotosWithDocuments: async (inputs) => {
          const photos = inputs.map((input) => ({ ...input, createdAt: 1, sourceAvailable: true }));
          const documents = Object.fromEntries(
            inputs.map((input) => [input.id, createDevelopDocument(input.id)]),
          );
          library.photos.push(...photos);
          Object.assign(library.documents, documents);
          if (hold === "receipt") {
            entered.resolve();
            await release.promise;
          }
          return { photos, documents };
        },
      },
    },
  );
  const start = (count = 1) =>
    session.startFiles(
      Array.from(
        { length: count },
        (_, index) =>
          new File([`${scope} synthetic ${index}`], `${scope}-${index}.jpg`, {
            type: "image/jpeg",
          }),
      ),
    );
  return { session, start, entered, release, library, signal: () => signal!, job: () => job };
}
const key = (scope: string) => JSON.stringify([scope, "shoot:synthetic-account-boundary"]);

describe("Develop import account lifetime across application shells", () => {
  test.each([
    ["/develop", "owner-b", true],
    ["/earnings", null, true],
    ["/auth", null, true],
    ["/develop", "owner-b", false],
  ] as const)(
    "account change on %s cancels old-owner late previews before saving",
    async (path, nextScope, setupComplete) => {
      const old = importFixture("owner-a"),
        current = nextScope ? importFixture(nextScope) : null;
      const sessions = new Map([[key("owner-a"), old.session]]);
      const boundary = boundaryFixture(sessions);
      const tasks = [old.start()];
      try {
        await old.entered.promise;
        expect(boundary.render(account("owner-a"), "/shoots/legacy/develop")).toMatchObject({
          type: "workbench",
        });
        expect(boundary.render(account("owner-a"), "/develop")).toMatchObject({
          type: "dashboard",
        });
        expect(boundary.render(account("owner-a"), "/earnings")).toMatchObject({
          type: "dashboard",
        });
        expect(old.signal().aborted).toBe(false);
        if (current) {
          sessions.set(key(nextScope!), current.session);
          tasks.push(current.start());
          await current.entered.promise;
        }
        const nextBranch = boundary.render(account(nextScope, setupComplete), path);
        if (path === "/auth") expect(nextBranch).toBe("route");
        else expect(nextBranch).toMatchObject({ type: setupComplete ? "dashboard" : "setup" });
        expect(old.signal().aborted).toBe(true);
        if (current) expect(current.signal().aborted).toBe(false);
        expect(boundary.cancellations).toEqual(["owner-a", nextScope ?? "signed-out"]);
        old.release.resolve();
        current?.release.resolve();
        await Promise.all(tasks);
        expect(old.library.photos).toHaveLength(0);
        expect(old.session.getSnapshot().phase).toBe("cancelled");
        if (current) {
          expect(current.library.photos).toHaveLength(1);
          expect(current.session.getSnapshot().phase).toBe("complete");
        }
      } finally {
        old.session.cancel();
        current?.session.cancel();
        old.release.resolve();
        current?.release.resolve();
        await Promise.allSettled(tasks);
      }
    },
  );

  test("sign-out preserves an already committed transaction and cancels remaining files", async () => {
    const old = importFixture("owner-a", "receipt");
    const boundary = boundaryFixture(new Map([[key("owner-a"), old.session]]));
    const task = old.start(2);
    try {
      await old.entered.promise;
      expect(boundary.render(account("owner-a"), "/shoots/legacy/develop")).toMatchObject({
        type: "workbench",
      });
      expect(boundary.render(account("owner-a"), "/earnings")).toMatchObject({ type: "dashboard" });
      expect(boundary.render(account(null), "/earnings")).toMatchObject({ type: "dashboard" });
      expect(old.signal().aborted).toBe(true);
      old.release.resolve();
      await task;
      expect(old.library.photos).toHaveLength(1);
      expect(old.session.getSnapshot()).toMatchObject({ phase: "cancelled", saved: 1 });
      expect(old.job()?.rows.map((row) => row.status)).toEqual(["saved", "cancelled"]);
      expect(old.job()?.rows[0]?.photoId).toBe(old.library.photos[0]?.id);
    } finally {
      old.session.cancel();
      old.release.resolve();
      await task;
    }
  });
});
