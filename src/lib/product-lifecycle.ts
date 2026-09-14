import { createProductAnalytics, type ProductEvent } from "./product-analytics";

type Client = ReturnType<typeof createProductAnalytics>;
type Properties = Record<string, unknown>;
export type ProductCapture = (event: ProductEvent, properties?: Properties) => void;
const noop: ProductCapture = () => {};
let session:
  { owner: string; client: Client; allowed: () => boolean; cancel: Set<() => void> } | undefined;

/** React owns one verified account session. Async producers retain this exact session,
 * never whichever account happens to be signed in when their work finishes. */
export function connectProductAnalytics(owner: string, client: Client, allowed: () => boolean) {
  disconnectProductAnalytics();
  const current = { owner, client, allowed, cancel: new Set<() => void>() };
  session = current;
  return () => {
    for (const cancel of current.cancel) cancel();
    client.close();
    if (session === current) session = undefined;
  };
}
export function disconnectProductAnalytics(nextOwner?: string | null) {
  if (session && session.owner !== nextOwner) {
    for (const cancel of session.cancel) cancel();
    session.client.close();
    session = undefined;
  }
}
export function productCapture(owner: string | null | undefined, shoot?: string): ProductCapture {
  const current = session;
  try {
    if (
      !current ||
      current.client.enabled === false ||
      current.owner !== owner ||
      !current.allowed()
    )
      return noop;
  } catch {
    return noop;
  }
  // Library prefixes are internal routing context, not transmitted identifiers.
  const shootId = shoot?.replace(/^(shoot|project):/, "");
  return (event, properties = {}) => {
    try {
      if (session !== current || !current.allowed()) return;
      void current.client.capture(event, { ...properties, shoot_id: shootId }).catch(() => {});
    } catch {
      /* Telemetry can never interrupt photography. */
    }
  };
}

/** Durations are operation clocks, not decode throughput. No backlog before consent. */
export function productOperation(
  owner: string | null | undefined,
  shoot: string | undefined,
  kind: "import" | "cull" | "export",
  properties: Properties = {},
  now = () => performance.now(),
) {
  const capture = productCapture(owner, shoot);
  const started = now();
  let complete = false;
  capture(`${kind}_started`, properties);
  return {
    capture,
    finish(extra: Properties = {}) {
      if (complete) return;
      complete = true;
      capture(`${kind}_completed`, { ...properties, ...extra, processing_ms: now() - started });
    },
    fail() {
      if (complete) return;
      complete = true;
      if (kind === "cull")
        capture("cull_failed", { ...properties, processing_ms: now() - started });
    },
    firstSelect() {
      capture("first_select_shown", { time_to_first_select_ms: now() - started });
    },
  };
}

type Verdict = "keep" | "reject" | "undecided";
/** Only explicit recommendations produced in this view can be attributed to AI.
 * Restored picks and manual-to-manual changes must not become invented overrides. */
export function cullReviewTelemetry(operation: ReturnType<typeof productOperation>) {
  const suggested = new Map<string, Verdict>();
  const reviewed = new Map<string, Verdict>();
  let shown = false;
  let active = true;
  function classify(id: string, verdict: Verdict): ProductEvent | undefined {
    if (!active) return;
    const before = suggested.get(id);
    if (
      !before ||
      before === "undecided" ||
      verdict === "undecided" ||
      reviewed.get(id) === verdict
    )
      return;
    reviewed.set(id, verdict);
    return before === "keep"
      ? verdict === "keep"
        ? "keeper_accepted"
        : "keeper_overridden"
      : verdict === "keep"
        ? "reject_overridden"
        : undefined;
  }
  function reviewBatch(frames: readonly { id: string; verdict: Verdict }[]) {
    const totals = new Map<ProductEvent, number>();
    for (const frame of frames) {
      const event = classify(frame.id, frame.verdict);
      if (event) totals.set(event, (totals.get(event) ?? 0) + 1);
    }
    for (const [event, count] of totals)
      operation.capture(event, {
        photo_count: count,
        manual_overrides: event === "keeper_accepted" ? 0 : count,
      });
  }
  return {
    invalidate() {
      active = false;
      suggested.clear();
      reviewed.clear();
    },
    suggest(frames: readonly { id: string; verdict: Verdict }[]) {
      if (!active) return;
      for (const frame of frames) suggested.set(frame.id, frame.verdict);
    },
    shown(id: string) {
      if (active && !shown && suggested.get(id) === "keep") {
        shown = true;
        operation.firstSelect();
      }
    },
    review(id: string, verdict: Verdict) {
      reviewBatch([{ id, verdict }]);
    },
    reviewBatch,
  };
}

// Only an explicit successful password-signup response can set this marker.
// Memory-only, consent-gated; no email, tokens or retrospective signup inference.
let signup: { owner: string; expires: number } | undefined;
export function revokeProductAnalytics() {
  signup = undefined;
  disconnectProductAnalytics();
}
export function noteCompletedSignup(owner: string, allowed: boolean) {
  if (!allowed || !/^[0-9a-f-]{36}$/i.test(owner)) return;
  signup = { owner, expires: Date.now() + 30 * 60_000 };
  emitCompletedSignup(owner);
}
export function emitCompletedSignup(owner: string) {
  if (!session || session.owner !== owner || signup?.owner !== owner) return;
  const pending = signup;
  signup = undefined;
  if (pending.expires >= Date.now()) productCapture(owner)("signup_completed");
}

/** Separate analytics-only ledger. Never writes the photo library. The second-shoot
 * milestone is the second DISTINCT consented creation observed on this browser,
 * not a claim about historical or cross-device account lifetime. */
export async function recordShootCreation(owner: string, shootId: string) {
  const capture = productCapture(owner, shootId);
  if (capture === noop || !/^[0-9a-f-]{36}$/i.test(shootId)) return;
  const originalSession = session!;
  let cancelled = false;
  let transaction: IDBTransaction | undefined;
  const cancel = () => {
    cancelled = true;
    try {
      transaction?.abort();
    } catch {
      /* Already settled. */
    }
  };
  originalSession.cancel.add(cancel);
  let db: IDBDatabase | undefined;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("lenslabs-consented-product-milestones-v1", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("milestones");
      req.onsuccess = () => {
        if (cancelled) req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        cancelled = true;
        reject(new Error("Analytics storage blocked"));
      };
    });
    const current = session;
    if (cancelled || current !== originalSession || !current.allowed()) return;
    const result = await new Promise<number>((resolve, reject) => {
      const tx = db!.transaction("milestones", "readwrite");
      transaction = tx;
      const store = tx.objectStore("milestones");
      const key = `${owner}:${shootId}`;
      let count = 0;
      const known = store.get(key);
      known.onsuccess = () => {
        if (known.result) return;
        const sequence = store.get(owner);
        sequence.onsuccess = () => {
          if (cancelled || session !== originalSession || !originalSession.allowed()) {
            cancel();
            return;
          }
          count = Math.min(3, (Number(sequence.result) || 0) + 1);
          store.put(true, key);
          store.put(count, owner);
        };
      };
      tx.oncomplete = () => resolve(count);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    if (result) capture("shoot_created");
    if (result === 2) capture("second_shoot_created");
  } catch {
    /* Optional analytics storage cannot fail a shoot creation. */
  } finally {
    originalSession.cancel.delete(cancel);
    db?.close();
  }
}

/** Bind at the start of the application save, not after its asynchronous commit. */
export function prepareShootCreation(owner: string, shootId: string) {
  const original = session;
  const enabled = productCapture(owner, shootId) !== noop;
  return async () => {
    if (enabled && session === original) await recordShootCreation(owner, shootId);
  };
}

export function analysisDecoderDomain(backends: readonly (string | undefined)[]) {
  if (
    !backends.length ||
    backends.some((value) => !["native-cpp", "worker", "main-thread"].includes(value ?? ""))
  )
    return undefined;
  const native = backends.some((value) => value === "native-cpp");
  const browser = backends.some((value) => value !== "native-cpp");
  return native && browser ? "mixed-v1" : native ? "native-cpp-v1" : "browser-v1";
}
