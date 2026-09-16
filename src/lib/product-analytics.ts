import { consentFromCookie } from "./marketing-consent";

/** Event-only transport: no SDK, DOM collection, replay, identity persistence or retries. */
export const PRODUCT_EVENTS = [
  "signup_completed",
  "waitlist_joined",
  "waitlist_cta_clicked",
  "app_opened",
  "shoot_created",
  "second_shoot_created",
  "import_started",
  "import_completed",
  "cull_started",
  "first_select_shown",
  "cull_completed",
  "burst_opened",
  "keeper_accepted",
  "keeper_overridden",
  "reject_overridden",
  "export_started",
  "export_completed",
  "decode_failed",
  "cull_failed",
  "subscription_started",
  "subscription_cancelled",
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];
const events = new Set<string>(PRODUCT_EVENTS);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const counts = ["photo_count", "raw_count", "jpeg_count", "keepers_suggested", "manual_overrides"];
const measurements = ["processing_ms", "time_to_first_select_ms", "photos_per_second"];
const categories: Record<string, readonly string[]> = {
  decoder_domain: ["sports-canonical-rgba256-v2", "native-cpp-v1", "browser-v1", "mixed-v1"],
  camera_category: ["dslr", "mirrorless", "phone", "other", "unknown"],
  os: ["macos", "linux", "windows", "ios", "android", "unknown"],
  architecture: ["arm64", "x86_64", "unknown"],
  sport: ["football", "basketball", "soccer", "baseball", "hockey", "tennis", "other", "unknown"],
};

/** Never spread caller properties: EXIF, error strings, URLs and DOM content are untrusted. */
export function safeProductProperties(
  input: Record<string, unknown>,
): Record<string, string | number> {
  const output: Record<string, string | number> = {};
  for (const key of [...counts, ...measurements]) {
    const value = input[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1e12 &&
      (!counts.includes(key) || Number.isSafeInteger(value))
    )
      output[key] = value;
  }
  for (const [key, values] of Object.entries(categories)) {
    const value = input[key];
    if (typeof value === "string" && values.includes(value)) output[key] = value;
  }
  if (typeof input["shoot_id"] === "string" && uuid.test(input["shoot_id"]))
    output["shoot_id"] = input["shoot_id"];
  // Camera strings, version strings and all other free text stay out until separately normalized.
  return output;
}

export type AnalyticsConfig = { enabled?: string; key?: string; host?: string };
export function createProductAnalytics(options: {
  config: AnalyticsConfig;
  accountId: string;
  cookie: () => string;
  fetch: (url: string, init: RequestInit) => Promise<Pick<Response, "ok">>;
  timeoutMs?: number;
}) {
  const { config, accountId } = options;
  const configured =
    config.enabled === "true" &&
    /^phc_[A-Za-z0-9]+$/.test(config.key ?? "") &&
    ["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(config.host ?? "") &&
    uuid.test(accountId);
  const pending = new Set<AbortController>();
  const queue: Array<{
    event: ProductEvent;
    properties: Record<string, string | number>;
    timestamp: string;
    resolve: (ok: boolean) => void;
  }> = [];
  let closed = false;
  const transport = {
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
      pending.clear();
      for (const item of queue.splice(0)) item.resolve(false);
    },
    async capture(
      event: ProductEvent,
      properties: Record<string, unknown> = {},
      timestamp = new Date().toISOString(),
    ): Promise<boolean> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let controller: AbortController | undefined;
      try {
        if (
          !configured ||
          closed ||
          pending.size >= 4 ||
          !events.has(event) ||
          consentFromCookie(options.cookie()) !== "accepted"
        )
          return false;
        const safe = safeProductProperties(properties);
        controller = new AbortController();
        pending.add(controller);
        timer = setTimeout(() => controller?.abort(), options.timeoutMs ?? 2000);
        const response = await options.fetch(`${config.host}/i/v0/e/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          body: JSON.stringify({
            api_key: config.key,
            distinct_id: accountId,
            event,
            timestamp,
            properties: {
              ...safe,
              user_id: accountId,
              $process_person_profile: false,
              $geoip_disable: true,
              $ip: null,
            },
          }),
        });
        return response.ok && !closed && !controller.signal.aborted;
      } catch {
        // Analytics must never break import, editing, account access or export. No raw error logging.
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (controller) pending.delete(controller);
        const next = queue.shift();
        if (next)
          void transport.capture(next.event, next.properties, next.timestamp).then(next.resolve);
      }
    },
  };
  return {
    enabled: configured,
    close: transport.close,
    capture(event: ProductEvent, properties: Record<string, unknown> = {}): Promise<boolean> {
      try {
        if (
          closed ||
          !configured ||
          !events.has(event) ||
          consentFromCookie(options.cookie()) !== "accepted"
        )
          return Promise.resolve(false);
        if (pending.size < 4) return transport.capture(event, properties);
        // Sanitized memory-only queue: never persist, retry, or block photography.
        if (queue.length >= 128) return Promise.resolve(false);
        const safe = safeProductProperties(properties);
        return new Promise((resolve) =>
          queue.push({ event, properties: safe, timestamp: new Date().toISOString(), resolve }),
        );
      } catch {
        return Promise.resolve(false);
      }
    },
  };
}
