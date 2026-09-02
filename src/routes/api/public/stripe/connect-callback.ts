import { createFileRoute } from "@tanstack/react-router";

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
        const back = (msg: string) =>
          new Response(null, { status: 302, headers: { location: `/earnings?stripe=${msg}` } });

        if (!code || !state) return back("denied");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("stripe_oauth_states")
          .select("user_id, created_at")
          .eq("state", state)
          .maybeSingle();
        if (!row) return back("bad_state");
        await supabaseAdmin.from("stripe_oauth_states").delete().eq("state", state);
        if (Date.now() - new Date(row.created_at as string).getTime() > 15 * 60_000)
          return back("expired");

        try {
          const { platformStripe } = await import("@/lib/stripe-connect.server");
          const stripe = platformStripe();
          const token = await stripe.oauth.token({
            grant_type: "authorization_code",
            code,
          });
          const accountId = token.stripe_user_id;
          if (!accountId) return back("failed");

          await supabaseAdmin
            .from("profiles")
            .upsert({
              id: row.user_id as string,
              stripe_account_id: accountId,
              stripe_account_status: "connected",
              updated_at: new Date().toISOString(),
            });
          return back("connected");
        } catch (e) {
          console.error("Stripe connect callback failed", e);
          return back("failed");
        }
      },
    },
  },
});
