import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createProductAnalytics } from "../src/lib/product-analytics";
import { consentFromCookie } from "../src/lib/marketing-consent";
import {
  connectProductAnalytics,
  emitCompletedSignup,
  revokeProductAnalytics,
  productCapture,
} from "../src/lib/product-lifecycle";

// Real effect code; isolated EventTarget/cookie/transport, no app/browser cookies.
const compiled = new Bun.Transpiler({ loader: "tsx" })
  .transformSync(
    readFileSync("src/components/account/ProductAnalytics.tsx", "utf8").replaceAll(
      "import.meta.env",
      "config",
    ),
  )
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
  .replace("export function ProductAnalytics", "function ProductAnalytics");
const owner = "12345678-1234-4123-a123-123456789012";
function fixture(account: any = { status: "in", local: false, scope: owner }, accepted = false) {
  const state = { cookie: accepted ? "foto_consent=accepted" : "" };
  const events: any[] = [];
  const window = new EventTarget();
  const channels: any[] = [];
  const effects: Array<() => (() => void) | undefined> = [];
  const context = {
    config: {
      VITE_POSTHOG_ENABLED: "true",
      VITE_POSTHOG_HOST: "https://us.i.posthog.com",
      VITE_POSTHOG_KEY: "phc_TESTNOTAREALKEY",
    },
    useAccount: () => account,
    useEffect: (effect: () => (() => void) | undefined) => effects.push(effect),
    document: {
      get cookie() {
        return state.cookie;
      },
    },
    window,
    fetch: async (_url: string, init: RequestInit) => {
      events.push(JSON.parse(String(init.body)));
      return { ok: true };
    },
    BroadcastChannel: class {
      onmessage?: () => void;
      closed = false;
      constructor() {
        channels.push(this);
      }
      close() {
        this.closed = true;
      }
    },
    createProductAnalytics,
    consentFromCookie,
    connectProductAnalytics,
    emitCompletedSignup,
    revokeProductAnalytics,
  };
  new Function(...Object.keys(context), `${compiled}\nProductAnalytics();`)(
    ...Object.values(context),
  );
  const cleanup = effects.map((effect) => effect());
  return { events, state, window, channels, close: () => cleanup.forEach((fn) => fn?.()) };
}
afterEach(revokeProductAnalytics);
describe("real ProductAnalytics account/consent effect", () => {
  test("accept enables app_opened once; revocation stops real producers; regrant has a fresh session", () => {
    const h = fixture();
    try {
      expect(h.events).toEqual([]);
      h.state.cookie = "foto_consent=accepted";
      h.window.dispatchEvent(new Event("foto-consent-changed"));
      h.window.dispatchEvent(new Event("focus"));
      expect(h.events.map((p) => p.event)).toEqual(["app_opened"]);
      const old = productCapture(owner);
      h.state.cookie = "foto_consent=rejected";
      h.window.dispatchEvent(new Event("foto-consent-changed"));
      old("import_completed");
      h.state.cookie = "foto_consent=accepted";
      h.window.dispatchEvent(new Event("foto-consent-changed"));
      old("export_completed");
      expect(h.events.map((p) => p.event)).toEqual(["app_opened", "app_opened"]);
    } finally {
      h.close();
    }
  });
  test("cross-tab consent message rereads cookie and closes the account client", () => {
    const h = fixture(undefined, true);
    h.state.cookie = "foto_consent=rejected";
    h.channels[0].onmessage();
    productCapture(owner)("cull_started");
    expect(h.events.map((p) => p.event)).toEqual(["app_opened"]);
    h.close();
    expect(h.channels[0].closed).toBe(true);
  });
  for (const account of [
    { status: "out", scope: null },
    { status: "loading", scope: owner },
    { status: "in", scope: owner, local: true },
  ]) {
    test(`no capture for unavailable account ${JSON.stringify(account)}`, () => {
      const h = fixture(account, true);
      expect(h.events).toEqual([]);
      h.close();
    });
  }
  test("effect cleanup cannot attribute delayed events to the next opaque account", () => {
    const a = fixture(undefined, true);
    const old = productCapture(owner);
    a.close();
    const other = "12345678-1234-4123-a123-123456789013";
    const b = fixture({ status: "in", local: false, scope: other }, true);
    old("import_completed");
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
    expect(b.events[0].distinct_id).toBe(other);
    b.close();
  });
});
