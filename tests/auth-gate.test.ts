import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseAuthSearch, signInHref } from "../src/lib/auth-flow";
import { observeSession } from "../src/lib/account-preferences";
import { SESSION_RESTORE_DEADLINE_MS } from "../src/lib/account-access";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("a signed-out private page returns to its exact path and search after sign-in", () => {
  expect(signInHref("/settings/billing?tab=usage")).toBe(
    "/auth?next=%2Fsettings%2Fbilling%3Ftab%3Dusage&mode=signin",
  );
  expect(signInHref("/studio")).toBe("/auth?next=%2Fstudio&mode=signin");
  const search = Object.fromEntries(
    new URL(signInHref("/deliver?workflow=1"), "https://celinen.invalid").searchParams,
  );
  expect(parseAuthSearch(search)).toEqual({ next: "/deliver?workflow=1", mode: "signin" });
});

test("next never leaves this origin", () => {
  for (const href of ["//evil.test", "https://evil.test/studio", "/\\evil.test", "/%2fevil.test"]) {
    expect(signInHref(href)).toBe("/auth?next=%2Fdashboard&mode=signin");
    expect(parseAuthSearch({ next: href }).next).toBe("/dashboard");
  }
  // /auth as its own destination would loop.
  expect(signInHref("/auth?next=/auth")).toBe("/auth?next=%2Fdashboard&mode=signin");
});

test("an Auth client that cannot start is a definitive signed-out answer", () => {
  const values: unknown[] = [];
  let failure: unknown;
  let restored = false;
  const stop = observeSession(
    () => {
      throw new Error("Missing Supabase environment variable(s)");
    },
    async () => {
      restored = true;
      return null;
    },
    (value) => values.push(value),
    (error) => {
      failure = error;
    },
  );
  expect(failure).toBeInstanceOf(Error);
  expect(values).toEqual([]);
  expect(restored).toBe(false);
  stop();
});

test("session restore has a deadline and both app shells share one redirect", () => {
  expect(SESSION_RESTORE_DEADLINE_MS).toBeGreaterThanOrEqual(5_000);
  expect(SESSION_RESTORE_DEADLINE_MS).toBeLessThanOrEqual(15_000);
  const provider = source("components/account/AccountProvider.tsx");
  expect(provider).toContain("setTimeout(restoreFailed, SESSION_RESTORE_DEADLINE_MS)");
  // The first definitive answer and unmount both disarm it.
  expect(provider.match(/clearTimeout\(deadline\)/g)?.length).toBe(3);

  const gate = source("components/account/useSignedOutRedirect.ts");
  expect(gate).toContain('if (status === "out") window.location.replace(signInHref(href))');
  // "loading" must never redirect: that is the Sign In flash for a restoring session.
  expect(gate).not.toContain('"loading"');

  for (const shell of [
    "components/dashboard/AppDashboard.tsx",
    "components/workbench/Workbench.tsx",
  ]) {
    const text = source(shell);
    expect(text).toContain("useSignedOutRedirect()");
    expect(text).not.toContain('search: { next: "/dashboard", mode: "signin" }');
  }
});
