import { createClient } from "@supabase/supabase-js";
export function businessDatabase() {
  const url = process.env["SUPABASE_URL"],
    key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key)
    throw new Error(
      "Business sync needs its server connection. Your existing device records are untouched.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
}
