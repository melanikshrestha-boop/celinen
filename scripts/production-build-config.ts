// Public build configuration only. Runtime credentials never belong in VITE_*.
export const PRODUCTION_SUPABASE_URL = "https://yzyvooeoyavqtmjvsptv.supabase.co";

export function verifyProductionBuildEnvironment(env: Record<string, string | undefined>): void {
  if (env.VITE_SUPABASE_URL !== PRODUCTION_SUPABASE_URL)
    throw new Error("Production requires VITE_SUPABASE_URL for the yzyvoo Supabase project.");
  if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim())
    throw new Error("Set the production VITE_SUPABASE_PUBLISHABLE_KEY in Cloudflare build variables.");
  if (env.VITE_POSTHOG_ENABLED !== "true" || env.VITE_POSTHOG_HOST !== "https://us.i.posthog.com" || !env.VITE_POSTHOG_KEY?.trim())
    throw new Error("Set VITE_POSTHOG_ENABLED, VITE_POSTHOG_HOST and VITE_POSTHOG_KEY in Cloudflare build variables. Consent remains required.");
  for (const key of Object.keys(env)) {
    if (/^VITE_.*(?:SECRET|PRIVATE|SERVICE_ROLE|AI_API_TOKEN)/i.test(key))
      throw new Error("Server credentials must not be exposed through VITE_* build variables.");
  }
}
