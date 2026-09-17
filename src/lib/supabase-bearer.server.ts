/** Verify a Supabase access token on the Worker. Paid model calls are for signed-in users only. */

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function verifySupabaseBearer(
  request: Request,
  signInMessage: string,
): Promise<{ sub: string } | Response> {
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!token || token.split(".").length !== 3) return json(401, signInMessage);
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !supabaseKey) return json(500, "Auth is not configured.");
  const { createClient } = await import("@supabase/supabase-js");
  const authClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error } = await authClient.auth
    .getClaims(token)
    .catch(() => ({ data: null, error: true }));
  const sub = claims?.claims?.sub;
  if (error || typeof sub !== "string" || !sub) return json(401, signInMessage);
  return { sub };
}
