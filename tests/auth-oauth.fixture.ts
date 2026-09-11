// Isolated OAuth boundary: synthetic tokens only, no network or persisted account.
import { mock } from "bun:test";
import * as React from "react";
import * as Router from "@tanstack/react-router";
const originalReact = { ...React };
const originalRouter = { ...Router };
const tokens = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
const verified = {
  id: "qa-owner",
  email: "qa@example.test",
  email_confirmed_at: "2026-09-09",
  is_anonymous: false,
};
const session = { ...tokens, user: verified };
let providerResult: unknown = { tokens, error: null };
let installResult: unknown = { data: { session, user: verified }, error: null };
let providerFailure: unknown = null,
  installFailure: unknown = null;
let providerCalls = 0,
  installs = 0;
let lastOptions: unknown;
let pendingInstall: Promise<unknown> | null = null;
mock.module("@lovable.dev/cloud-auth-js", () => ({
  createLovableAuth: () => ({
    async signInWithOAuth(_provider: string, options: unknown) {
      providerCalls++;
      lastOptions = options;
      if (providerFailure) throw providerFailure;
      return providerResult;
    },
  }),
}));
mock.module("../src/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      async setSession(input: unknown) {
        installs++;
        check(
          JSON.stringify(input) === JSON.stringify(tokens),
          "OAuth tokens changed before installation",
        );
        if (installFailure) throw installFailure;
        if (pendingInstall) return pendingInstall;
        return installResult;
      },
    },
  },
}));
let checks = 0;
function check(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
  checks++;
}
if (process.argv.includes("--legacy")) {
  const { lovable } = await import("../src/integrations/lovable");
  installResult = { data: { session: null, user: null }, error: new Error("Session rejected") };
  const result = await lovable.auth.signInWithOAuth("google");
  check(
    Boolean(result.error),
    "REGRESSION: returned setSession error was silently treated as sign-in success",
  );
  process.exit(0);
}
const { signInWithOAuth } = await import("../src/lib/auth/oauth");
const options = {
  redirect_uri: "https://lenslab.dev/auth?next=%2Fearnings",
  extraParams: { prompt: "select_account" },
};
let result = await signInWithOAuth("google", options);
check(result.status === "authenticated", "Valid verified installation rejected");
check(JSON.stringify(lastOptions) === JSON.stringify(options), "Provider redirect/options changed");
const returnedError = new Error("Session rejected");
installResult = { data: { session: null, user: null }, error: returnedError };
result = await signInWithOAuth("google");
check(
  result.status === "error" && result.error === returnedError,
  "Returned installation error was swallowed",
);
for (const data of [
  { session: null, user: null },
  { session, user: null },
  { session: { ...session, access_token: "" }, user: verified },
  { session: { ...session, user: { ...verified, id: "" } }, user: { ...verified, id: "" } },
  { session: { ...session, user: { id: "other" } }, user: verified },
  { session, user: { ...verified, email_confirmed_at: null } },
  { session, user: { ...verified, is_anonymous: true } },
]) {
  installResult = { data, error: null };
  check(
    (await signInWithOAuth("google")).status === "error",
    "Incomplete/unverified account reported success",
  );
}
installResult = { data: { session, user: verified }, error: null };
providerResult = { redirected: true, error: null };
const beforeRedirect = installs;
check(
  (await signInWithOAuth("google", options)).status === "redirected",
  "Provider redirect not preserved",
);
check(installs === beforeRedirect, "Redirect path attempted session install");
providerResult = { error: new Error("Popup cancelled") };
check((await signInWithOAuth("google")).status === "error", "Provider rejection lost");
check(installs === beforeRedirect, "Provider failure installed tokens");
for (const invalid of [
  undefined,
  null,
  {},
  { access_token: "", refresh_token: "x" },
  { access_token: "x" },
  { access_token: 5, refresh_token: "x" },
]) {
  providerResult = { tokens: invalid, error: null };
  check((await signInWithOAuth("google")).status === "error", "Invalid broker token pair accepted");
}
check(installs === beforeRedirect, "Invalid token pair reached SDK installation");
providerFailure = new Error("Provider unavailable");
check((await signInWithOAuth("google")).status === "error", "Thrown provider error escaped");
providerFailure = null;
providerResult = { tokens, error: null };
installFailure = new Error("Storage unavailable");
check((await signInWithOAuth("google")).status === "error", "Thrown session error escaped");
installFailure = null;

// Real AuthScreen handlers: success/error/redirect and a late unmounted result.
let slots: unknown[] = [],
  cursor = 0;
const effects: (() => (() => void) | void)[] = [],
  cleanups: (() => void)[] = [];
mock.module("react", () => ({
  ...originalReact,
  useState(initial: unknown) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [
      slots[i],
      (next: unknown) => {
        slots[i] = next;
      },
    ];
  },
  useRef(initial: unknown) {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useEffect(effect: () => (() => void) | void) {
    const i = cursor++;
    if (!(i in slots)) {
      slots[i] = true;
      effects.push(effect);
    }
  },
}));
mock.module("@tanstack/react-router", () => ({ ...originalRouter, Link: "a" }));
Object.defineProperty(globalThis, "window", {
  value: { location: { origin: "https://lenslab.dev" } },
  configurable: true,
});
const { AuthScreen } = await import("../src/components/account/AuthScreen");
type Node = { type?: unknown; props?: Record<string, unknown> };
function children(node: unknown): unknown[] {
  return Array.isArray(node)
    ? node
    : node && typeof node === "object"
      ? [(node as Node).props?.children]
      : [];
}
function find(node: unknown, predicate: (node: Node) => boolean): Node | null {
  if (node && typeof node === "object" && !Array.isArray(node) && predicate(node as Node))
    return node as Node;
  for (const child of children(node)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : children(node).map(text).join("");
let tree: unknown,
  navigated = 0;
const props = {
  next: "/earnings?shoot=qa#review",
  mode: "signin" as const,
  onAuthenticated: () => {
    navigated++;
  },
};
function render() {
  cursor = 0;
  tree = AuthScreen(props);
  for (const effect of effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}
function reset() {
  for (const cleanup of cleanups.splice(0)) cleanup();
  slots = [];
  navigated = 0;
  render();
  render();
}
function google() {
  (find(tree, (node) => node.props?.className === "auth-google")!.props!.onClick as () => void)();
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  render();
};
reset();
installResult = { data: { session: null, user: null }, error: returnedError };
google();
await settle();
check(
  navigated === 0 && text(tree).includes("Session rejected"),
  "AuthScreen navigated after failed session install",
);
check(
  new URL((lastOptions as { redirect_uri: string }).redirect_uri).searchParams.get("next") ===
    props.next,
  "Safe deep-link destination lost",
);
installResult = { data: { session: null, user: null }, error: null };
google();
await settle();
check(navigated === 0, "AuthScreen navigated with no session");
providerResult = { redirected: true, error: null };
google();
await settle();
check(navigated === 0, "AuthScreen navigated while provider was redirecting");
providerResult = { tokens, error: null };
let release!: (value: unknown) => void;
pendingInstall = new Promise((resolve) => {
  release = resolve;
});
google();
google();
await settle();
const duringCalls = providerCalls;
check(navigated === 0, "AuthScreen navigated before installation completed");
google();
await settle();
check(providerCalls === duringCalls, "Pending OAuth accepted duplicate submission");
release({ data: { session, user: verified }, error: null });
await settle();
check(navigated === 1, "Verified completed install did not navigate once");
pendingInstall = null;
reset();
pendingInstall = new Promise((resolve) => {
  release = resolve;
});
google();
await settle();
for (const cleanup of cleanups.splice(0)) cleanup();
release({ data: { session, user: verified }, error: null });
await settle();
check(navigated === 0, "Unmounted sign-in navigated on late success");
pendingInstall = null;
console.log(`AUTH_OAUTH_OK ${checks}`);
