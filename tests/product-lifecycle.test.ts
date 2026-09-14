import { afterEach, describe, expect, test } from "bun:test";
import { createProductAnalytics } from "../src/lib/product-analytics";
import {
  connectProductAnalytics,
  disconnectProductAnalytics,
  productCapture,
  productOperation,
  cullReviewTelemetry,
  noteCompletedSignup,
  emitCompletedSignup,
  revokeProductAnalytics,
  analysisDecoderDomain,
} from "../src/lib/product-lifecycle";

const owner = "12345678-1234-4123-a123-123456789012";
const other = "12345678-1234-4123-a123-123456789013";
const shoot = "12345678-1234-4123-a123-123456789014";
function session(id = owner) {
  const payloads: any[] = [];
  const state = { consent: true };
  const client = createProductAnalytics({
    config: { enabled: "true", host: "https://us.i.posthog.com", key: "phc_TESTNOTAREALKEY" },
    accountId: id,
    cookie: () => (state.consent ? "foto_consent=accepted" : "foto_consent=rejected"),
    fetch: async (_url, init) => {
      payloads.push(JSON.parse(String(init.body)));
      return { ok: true };
    },
  });
  const close = connectProductAnalytics(id, client, () => state.consent);
  return { state, payloads, close };
}
afterEach(() => disconnectProductAnalytics());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("account-bound lifecycle producers", () => {
  test("absent consent and signed-out operations have no backlog after consent", () => {
    const h = session();
    h.state.consent = false;
    const old = productOperation(owner, shoot, "import");
    h.state.consent = true;
    old.finish();
    productCapture(other, shoot)("app_opened");
    expect(h.payloads).toEqual([]);
    productOperation(owner, shoot, "import").finish({ photo_count: 3 });
    expect(h.payloads.map((p) => p.event)).toEqual(["import_started", "import_completed"]);
  });
  test("switching users fences old results even after switching back", () => {
    const a = session();
    const old = productOperation(owner, shoot, "export");
    const b = session(other);
    old.finish();
    productCapture(other, shoot)("app_opened");
    const c = session(owner);
    old.finish();
    expect(a.payloads.map((p) => p.event)).toEqual(["export_started"]);
    expect(b.payloads).toHaveLength(1);
    expect(c.payloads).toHaveLength(0);
    expect(b.payloads[0].distinct_id).toBe(other);
  });
  test("revocation stops operations already in progress", () => {
    const h = session();
    const work = productOperation(owner, shoot, "import");
    h.state.consent = false;
    work.finish();
    expect(h.payloads.map((p) => p.event)).toEqual(["import_started"]);
  });
  test("durations and completion are once per operation and normalized IDs only", () => {
    const h = session();
    let now = 10;
    const work = productOperation(
      owner,
      `shoot:${shoot}`,
      "export",
      { filename: "private.jpg" },
      () => now,
    );
    now = 250;
    work.finish({ photo_count: 1 });
    work.finish();
    expect(h.payloads).toHaveLength(2);
    expect(h.payloads[1].properties.processing_ms).toBe(240);
    expect(h.payloads[1].properties.shoot_id).toBe(shoot);
    expect(JSON.stringify(h.payloads)).not.toContain("private.jpg");
  });
  test("failure is not completion and cannot report a later success", () => {
    const h = session();
    const work = productOperation(owner, shoot, "cull");
    work.fail();
    work.finish();
    work.fail();
    expect(h.payloads.map((p) => p.event)).toEqual(["cull_started", "cull_failed"]);
  });
  test("first select requires a real suggested keeper, shown once; restored picks are not AI", async () => {
    const h = session();
    const review = cullReviewTelemetry(productOperation(owner, shoot, "cull"));
    review.suggest([
      { id: "a", verdict: "keep" },
      { id: "b", verdict: "reject" },
    ]);
    review.shown("b");
    review.shown("restored");
    review.shown("a");
    review.shown("a");
    review.review("restored", "reject");
    review.review("a", "keep");
    review.review("a", "keep");
    review.review("a", "reject");
    review.review("b", "keep");
    await tick();
    expect(h.payloads.map((p) => p.event)).toEqual([
      "cull_started",
      "first_select_shown",
      "keeper_accepted",
      "keeper_overridden",
      "reject_overridden",
    ]);
    expect(JSON.stringify(h.payloads)).not.toContain("restored");
  });
  test("signed-up UUID must match a verified analytics session; no signup on login alone", () => {
    const h = session();
    emitCompletedSignup(owner);
    expect(h.payloads).toHaveLength(0);
    noteCompletedSignup(other, true);
    emitCompletedSignup(owner);
    expect(h.payloads).toHaveLength(0);
    const b = session(other);
    emitCompletedSignup(other);
    emitCompletedSignup(other);
    expect(b.payloads.map((p) => p.event)).toEqual(["signup_completed"]);
  });
  test("signup without consent produces nothing", () => {
    const h = session();
    noteCompletedSignup(owner, false);
    emitCompletedSignup(owner);
    expect(h.payloads).toHaveLength(0);
  });
  test("10,000-photo batch acceptance aggregates instead of overflowing the event queue", () => {
    const h = session();
    const review = cullReviewTelemetry(productOperation(owner, shoot, "cull"));
    const frames = Array.from({ length: 10_000 }, (_, i) => ({
      id: String(i),
      verdict: "keep" as const,
    }));
    review.suggest(frames);
    review.reviewBatch(frames);
    review.reviewBatch(frames);
    expect(h.payloads.map((p) => p.event)).toEqual(["cull_started", "keeper_accepted"]);
    expect(h.payloads[1].properties.photo_count).toBe(10_000);
  });
  test("revocation clears a pending signup and stale cull recommendations", () => {
    const h = session();
    const review = cullReviewTelemetry(productOperation(owner, shoot, "cull"));
    review.suggest([{ id: "a", verdict: "keep" }]);
    review.invalidate();
    review.shown("a");
    review.review("a", "keep");
    noteCompletedSignup(other, true);
    revokeProductAnalytics();
    const b = session(other);
    emitCompletedSignup(other);
    expect(b.payloads).toHaveLength(0);
    expect(h.payloads.map((p) => p.event)).toEqual(["cull_started"]);
  });
  test("expired signup marker does not count a later login", () => {
    const original = Date.now;
    try {
      Date.now = () => 1;
      noteCompletedSignup(other, true);
      Date.now = () => 31 * 60_000;
      const h = session(other);
      emitCompletedSignup(other);
      expect(h.payloads).toHaveLength(0);
    } finally {
      Date.now = original;
    }
  });
  test("decoder domain comes only from actual receipt backend, never guesses V2", () => {
    expect(analysisDecoderDomain(["native-cpp"])).toBe("native-cpp-v1");
    expect(analysisDecoderDomain(["worker", "main-thread"])).toBe("browser-v1");
    expect(analysisDecoderDomain(["native-cpp", "worker"])).toBe("mixed-v1");
    expect(analysisDecoderDomain([undefined])).toBeUndefined();
    expect(analysisDecoderDomain([])).toBeUndefined();
  });
  test("a broken analytics client cannot throw into application operations", () => {
    connectProductAnalytics(
      owner,
      {
        close() {},
        capture() {
          throw new Error("private");
        },
      } as any,
      () => true,
    );
    expect(() => productOperation(owner, shoot, "cull").finish()).not.toThrow();
  });
});
