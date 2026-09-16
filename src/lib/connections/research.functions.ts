import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const connectionAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getSession();
  if (!data.session)
    throw new Error(
      "Sign in to Celinen to use in-app web search. You can still open the search on the web.",
    );
  return next({ headers: { Authorization: `Bearer ${data.session.access_token}` } });
});
export const webSearchReadiness = createServerFn({ method: "GET" }).handler(async () => ({
  configured: Boolean(
    process.env["BRAVE_SEARCH_API_KEY"] &&
    process.env["SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"],
  ),
  provider: "Brave Search",
}));
export const searchWorkspaceWeb = createServerFn({ method: "POST" })
  .middleware([connectionAuth, requireSupabaseAuth])
  .inputValidator(z.object({ query: z.string().trim().min(2).max(500) }).strict())
  .handler(async ({ data, context }) => {
    const key = process.env["BRAVE_SEARCH_API_KEY"];
    if (!key)
      throw new Error(
        "In-app web search needs the search provider connected in Celinen hosting settings.",
      );
    return (await import("./research.server")).admittedWebSearch(context.userId, data.query, key);
  });
