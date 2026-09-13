// Isolated OAuth start: Google goes through Supabase, never Lovable's grant page.
import { mock } from "bun:test";
import * as React from "react";
import * as Router from "@tanstack/react-router";
const originalReact = { ...React };
const originalRouter = { ...Router };

const googleUrl = "https://trlmrcriryrhodnhzxnv.supabase.co/auth/v1/authorize?provider=google";
let providerResult: unknown = { data: { url: googleUrl }, error: null };
let providerFailure: unknown = null;
let providerCalls = 0;
let lastOAuth: unknown;
const assigned: string[] = [];

mock.module("../src/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      async signInWithOAuth(input: unknown) {
        providerCalls++;
        lastOAuth = input;
        if (providerFailure) throw providerFailure;
        return providerResult;
      },
    },
  },
}));

let checks = 0;
function check(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
  checks++;
}

Object.defineProperty(globalThis, "window", {
  value: {
    location: {
      origin: "https://lenslab.dev",
      assign(url: string) {
        assigned.push(url);
      },
    },
  },
  configurable: true,
});

const { signInWithOAuth } = await import("../src/lib/auth/oauth");
const options = {
  redirect_uri: "https://lenslab.dev/auth?next=%2Fearnings",
  extraParams: { hd: "studio.test" },
};

let result = await signInWithOAuth("google", options);
check(result.status === "redirected", "Valid Google authorize URL was not used");
check(assigned.at(-1) === googleUrl, "Browser did not leave for the Google authorize URL");
const sent = lastOAuth as {
  provider: string;
  options: { redirectTo?: string; skipBrowserRedirect?: boolean; queryParams?: Record<string, string> };
};
check(sent.provider === "google", "Provider was not Google");
check(sent.options.redirectTo === options.redirect_uri, "Return URL lost");
check(sent.options.skipBrowserRedirect === true, "SDK was allowed to navigate itself");
check(sent.options.queryParams?.prompt === "select_account", "Account chooser dropped");
check(sent.options.queryParams?.hd === "studio.test", "Extra Google params dropped");

providerResult = { data: { url: googleUrl }, error: new Error("Popup cancelled") };
const before = assigned.length;
check((await signInWithOAuth("google")).status === "error", "Provider rejection lost");
check(assigned.length === before, "Failed start still sent the browser away");

providerResult = { data: { url: "https://oauth.lovable.app/authorize" }, error: null };
check((await signInWithOAuth("google")).status === "error", "Lovable grant URL was accepted");
check(assigned.length === before, "Lovable grant URL was opened");

for (const url of [undefined, null, "", "http://evil.test/x", "not-a-url"]) {
  providerResult = { data: { url }, error: null };
  check((await signInWithOAuth("google")).status === "error", "Non-HTTPS authorize URL accepted");
}
check(assigned.length === before, "Invalid URL reached the browser");

providerFailure = new Error("Provider unavailable");
check((await signInWithOAuth("google")).status === "error", "Thrown provider error escaped");
providerFailure = null;
providerResult = { data: { url: googleUrl }, error: null };

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
providerResult = { data: { url: googleUrl }, error: new Error("Session rejected") };
google();
await settle();
check(
  navigated === 0 && text(tree).includes("Session rejected"),
  "AuthScreen navigated after failed Google start",
);
check(
  new URL(
    (lastOAuth as { options: { redirectTo: string } }).options.redirectTo,
  ).searchParams.get("next") === props.next,
  "Safe deep-link destination lost",
);
providerResult = { data: { url: googleUrl }, error: null };
google();
await settle();
check(navigated === 0, "AuthScreen treated a Google redirect as a finished session");
let release!: (value: unknown) => void;
const pending = new Promise((resolve) => {
  release = resolve;
});
providerResult = pending;
google();
google();
await settle();
const duringCalls = providerCalls;
check(navigated === 0, "AuthScreen navigated before Google authorize returned");
google();
await settle();
check(providerCalls === duringCalls, "Pending OAuth accepted duplicate submission");
release({ data: { url: googleUrl }, error: null });
await settle();
check(navigated === 0, "Completed Google redirect counted as an in-page sign-in");
reset();
const late = new Promise((resolve) => {
  release = resolve;
});
providerResult = late;
google();
await settle();
for (const cleanup of cleanups.splice(0)) cleanup();
release({ data: { url: googleUrl }, error: null });
await settle();
check(navigated === 0, "Unmounted sign-in navigated on late success");
console.log(`AUTH_OAUTH_OK ${checks}`);
