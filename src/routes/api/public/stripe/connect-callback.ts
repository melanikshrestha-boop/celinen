import { createFileRoute } from "@tanstack/react-router";
import { matchesOAuthBrowser, oauthCookieName } from "@/lib/earnings/connection-proof.server";

/**
 * Stripe Connect Standard OAuth callback.
 * Exchanges ?code for the photographer's connected account id and stores it
 * on their profile, then bounces back into the app.
 */
export const Route = createFileRoute("/api/public/stripe/connect-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const { connectRedirectUri } = await import("@/lib/stripe-connect.server");
        const secure = new URL(connectRedirectUri()).protocol === "https:";
        const back = (msg: string) =>
          new Response(null, {
            status: 302,
            headers: {
              location: `/earnings?stripe=${msg}`,
              "Set-Cookie": `${oauthCookieName(secure)}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
            },
          });

        if (!code || !state || !/^[a-f0-9]{32}$/.test(state)) return back("denied");
        // Possession of a copied authorization URL is not possession of the
        // initiating browser. Reject before consuming state or exchanging code.
        if (!matchesOAuthBrowser(request.headers.get("cookie"), state, secure))
          return back("bad_state");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error: stateError } = await supabaseAdmin
          .from("stripe_oauth_states")
          .delete()
          .eq("state", state)
          .select("user_id, created_at")
          .maybeSingle();
        if (stateError || !row) return back("bad_state");
        const age = Date.now() - new Date(row.created_at as string).getTime();
        if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000) return back("expired");

        try {
          const { platformStripe, issueConnectedAccountProof } =
            await import("@/lib/stripe-connect.server");
          const stripe = platformStripe();
          const token = await stripe.oauth.token({
            grant_type: "authorization_code",
            code,
          });
          const accountId = token.stripe_user_id;
          if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) return back("failed");
          const proof = await issueConnectedAccountProof(row.user_id as string, accountId);

          const saved = await supabaseAdmin.from("profiles").upsert({
            id: row.user_id as string,
            stripe_account_id: accountId,
            stripe_account_status: proof,
            updated_at: new Date().toISOString(),
          });
          if (saved.error) return back("failed");
          return back("connected");
        } catch {
          return back("failed");
        }
      },
    },
  },
});
