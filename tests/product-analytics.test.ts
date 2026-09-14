import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createProductAnalytics,
  safeProductProperties,
  PRODUCT_EVENTS,
  type ProductEvent,
} from "../src/lib/product-analytics";

const owner = "c1ca3a6e-aa70-4c1b-865e-f872a86ffde3";
const config = { enabled: "true", host: "https://us.i.posthog.com", key: "phc_TESTNOTAREALKEY" };
function harness(cookie = "foto_consent=accepted", overrides = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const state = { cookie };
  const client = createProductAnalytics({
    config,
    accountId: owner,
    cookie: () => state.cookie,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true };
    },
    ...overrides,
  });
  return { client, calls, state };
}

describe("PostHog event-only privacy boundary", () => {
  for (const cookie of [
    "",
    "foto_consent=rejected",
    "foto_consent=accepted-other",
    "other=accepted",
  ]) {
    test(`no analytics without accepted consent: ${cookie}`, async () => {
      const h = harness(cookie);
      expect(await h.client.capture("app_opened")).toBe(false);
      expect(h.calls).toHaveLength(0);
    });
  }
  for (const bad of [
    {},
    { ...config, enabled: "false" },
    { ...config, key: "phx_personal" },
    { ...config, host: "https://unapproved.example" },
    { ...config, host: "https://us.i.posthog.com/private" },
  ]) {
    test(`configuration fails closed: ${JSON.stringify(bad)}`, async () => {
      const h = harness(undefined, { config: bad });
      expect(await h.client.capture("app_opened")).toBe(false);
      expect(h.calls).toHaveLength(0);
    });
  }
  test("signed-out, path and email identities cannot capture", async () => {
    for (const accountId of ["", "/Users/private/photos", "private@example.test", "local-lab"]) {
      const h = harness(undefined, { accountId });
      expect(await h.client.capture("app_opened")).toBe(false);
      expect(h.calls).toHaveLength(0);
    }
  });
  test("unknown events including replay and identify are rejected", async () => {
    const h = harness();
    for (const event of ["$snapshot", "$autocapture", "$identify", "private-file.jpg"]) {
      expect(await h.client.capture(event as ProductEvent)).toBe(false);
    }
    expect(h.calls).toHaveLength(0);
  });
  test("payload excludes private metadata and cannot override transport identity", async () => {
    const h = harness();
    const privateText = "PRIVATE-CANARY-/Users/person/image.jpg-caption-name-token";
    expect(
      await h.client.capture("import_completed", {
        photo_count: 337,
        jpeg_count: 20,
        raw_count: 317,
        processing_ms: 2500,
        decoder_domain: "sports-canonical-rgba256-v2",
        os: "macos",
        architecture: "arm64",
        shoot_id: owner,
        camera: privateText,
        app_version: privateText,
        filename: privateText,
        local_path: privateText,
        caption: privateText,
        email: privateText,
        client_name: privateText,
        error: privateText,
        image: { pixels: privateText },
        thumbnail: privateText,
        token: privateText,
        api_key: privateText,
        distinct_id: privateText,
        $set: { email: privateText },
        $current_url: privateText,
        $process_person_profile: true,
      }),
    ).toBe(true);
    const { url, init } = h.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(init.body).not.toContain(privateText);
    expect(body.distinct_id).toBe(owner);
    expect(body.properties.photo_count).toBe(337);
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.$ip).toBeNull();
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.redirect).toBe("error");
  });
  test("invalid numbers and arbitrary strings cannot bypass allowlist", () => {
    expect(
      safeProductProperties({
        photo_count: -1,
        raw_count: 0.5,
        jpeg_count: Infinity,
        processing_ms: NaN,
        time_to_first_select_ms: "private",
        photos_per_second: 1e15,
        shoot_id: "/private",
        os: "private",
        architecture: "private",
        sport: "private",
        decoder_domain: "native-v2-guessed",
      }),
    ).toEqual({});
  });
  test("vocabulary contains all requested names without implying producers exist", () => {
    expect(PRODUCT_EVENTS).toHaveLength(19);
    expect(new Set(PRODUCT_EVENTS).size).toBe(19);
  });
  test("consent is checked on every request, not cached", async () => {
    const h = harness();
    expect(await h.client.capture("app_opened")).toBe(true);
    h.state.cookie = "foto_consent=rejected";
    expect(await h.client.capture("import_started")).toBe(false);
    h.state.cookie = "foto_consent=accepted";
    expect(await h.client.capture("import_started")).toBe(true);
    expect(h.calls).toHaveLength(2);
  });
  test("closed/account-disposed clients cannot send", async () => {
    const h = harness();
    h.client.close();
    expect(await h.client.capture("app_opened")).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
  test("no more than four requests admitted and close aborts outstanding work", async () => {
    const signals: AbortSignal[] = [];
    const h = harness(undefined, {
      fetch: async (_url: string, init: RequestInit) => {
        signals.push(init.signal!);
        return await new Promise((resolve) =>
          init.signal!.addEventListener("abort", () => resolve({ ok: false })),
        );
      },
    });
    const requests = Array.from({ length: 8 }, () => h.client.capture("app_opened"));
    expect(signals).toHaveLength(4);
    h.client.close();
    expect(await Promise.all(requests)).toEqual(Array(8).fill(false));
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
  test("timeout aborts a stalled transport without retries", async () => {
    let calls = 0;
    const h = harness(undefined, {
      timeoutMs: 5,
      fetch: async (_url: string, init: RequestInit) => {
        calls++;
        return await new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () => reject(new Error("private"))),
        );
      },
    });
    expect(await h.client.capture("app_opened")).toBe(false);
    expect(calls).toBe(1);
  });
  test("transport and consent errors never escape into photography operations", async () => {
    const h = harness(undefined, {
      fetch: async () => {
        throw new Error("private network detail");
      },
    });
    expect(await h.client.capture("app_opened")).toBe(false);
    const brokenCookie = harness(undefined, {
      cookie: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(await brokenCookie.client.capture("app_opened")).toBe(false);
  });
  test("HTTP failure never reports successful capture", async () => {
    const h = harness(undefined, { fetch: async () => ({ ok: false }) });
    expect(await h.client.capture("app_opened")).toBe(false);
  });
  test("no replay, DOM, local storage or profile data in the integration", () => {
    const source = readFileSync("src/lib/product-analytics.ts", "utf8");
    expect(source).not.toMatch(/posthog-js|localStorage|sessionStorage|querySelector|console\./);
    const component = readFileSync("src/components/account/ProductAnalytics.tsx", "utf8");
    expect(component).toContain('account?.status === "in" && !account.local');
    expect(component).not.toMatch(
      /account\.(user|name)|document\.(referrer|title)|window\.location/,
    );
  });
});
