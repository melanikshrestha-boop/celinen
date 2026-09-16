// Public browser build values only. Runtime secrets never belong in VITE_*.
export const PRODUCTION_SUPABASE_URL = 'https://yzyvooeoyavqtmjvsptv.supabase.co';
export const PRODUCTION_SUPABASE_PROJECT_ID = 'yzyvooeoyavqtmjvsptv';
export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zGbr2YrgYiDDeTRRMUNyrQ_EJFzAHem';
export const PRODUCTION_APP_ORIGIN = "https://lenslab.dev";
export const PRODUCTION_POSTHOG_HOST = 'https://us.i.posthog.com';
export const PRODUCTION_POSTHOG_KEY = 'phc_qmPZ74vsHXaxKeYKKBuajFNgVLTDfaYbk8cqm2aXMyrY';

const PRODUCTION_PUBLIC_ENV = {
  VITE_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
  VITE_SUPABASE_PROJECT_ID: PRODUCTION_SUPABASE_PROJECT_ID,
  VITE_SUPABASE_PUBLISHABLE_KEY: PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  VITE_APP_ORIGIN: PRODUCTION_APP_ORIGIN,
  VITE_POSTHOG_ENABLED: "true",
  VITE_POSTHOG_HOST: PRODUCTION_POSTHOG_HOST,
  VITE_POSTHOG_KEY: PRODUCTION_POSTHOG_KEY,
} as const;

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveProductionBuildEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = { ...PRODUCTION_PUBLIC_ENV };
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("VITE_")) continue;
    const next = present(value);
    if (next) resolved[key] = next;
  }
  verifyProductionBuildEnvironment(resolved);
  return resolved;
}

export function verifyProductionBuildEnvironment(env: Record<string, string | undefined>): void {
  if (env.VITE_SUPABASE_URL !== PRODUCTION_SUPABASE_URL)
    throw new Error("Production requires VITE_SUPABASE_URL for the yzyvoo Supabase project.");
  if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim())
    throw new Error("Set the production VITE_SUPABASE_PUBLISHABLE_KEY in Cloudflare build variables.");
  if (env.VITE_POSTHOG_ENABLED !== "true" || env.VITE_POSTHOG_HOST !== PRODUCTION_POSTHOG_HOST || !env.VITE_POSTHOG_KEY?.trim())
    throw new Error("Set VITE_POSTHOG_ENABLED, VITE_POSTHOG_HOST and VITE_POSTHOG_KEY in Cloudflare build variables. Consent remains required.");
  for (const key of Object.keys(env)) {
    if (/^VITE_.*(?:SECRET|PRIVATE|SERVICE_ROLE|AI_API_TOKEN)/i.test(key))
      throw new Error("Server credentials must not be exposed through VITE_* build variables.");
  }
}
