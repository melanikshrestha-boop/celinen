import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const verifiedBusinessAccount = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ context, next }) => {
    const { data, error } = await context.supabase.auth.getUser();
    if (
      error ||
      !data.user ||
      data.user.id !== context.userId ||
      data.user.is_anonymous ||
      !data.user.email ||
      !data.user.email_confirmed_at
    )
      throw new Error("Verify your email and sign in before using business connections.");
    return next();
  });
export const businessAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to open your business workspace.");
  return next({ headers: { Authorization: `Bearer ${data.session.access_token}` } });
});
