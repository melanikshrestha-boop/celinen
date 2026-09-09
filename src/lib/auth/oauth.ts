import {
  createLovableAuth,
  type OAuthProvider,
  type SignInWithOAuthOptions,
} from "@lovable.dev/cloud-auth-js";
import { supabase } from "@/integrations/supabase/client";
import { verifiedPhotographer } from "@/lib/account-access";

const broker = createLovableAuth();
export type OAuthSignInResult =
  { status: "redirected" } | { status: "authenticated" } | { status: "error"; error: Error };

/** Owned boundary: a broker token response is not an installed account session. */
export async function signInWithOAuth(
  provider: OAuthProvider,
  options?: SignInWithOAuthOptions,
): Promise<OAuthSignInResult> {
  try {
    const result = await broker.signInWithOAuth(provider, {
      ...options,
      extraParams: { ...options?.extraParams },
    });
    if (result.error) return { status: "error", error: result.error };
    if (result.redirected) return { status: "redirected" };
    const tokens = result.tokens;
    if (
      !tokens ||
      typeof tokens.access_token !== "string" ||
      !tokens.access_token.trim() ||
      typeof tokens.refresh_token !== "string" ||
      !tokens.refresh_token.trim()
    )
      return {
        status: "error",
        error: new Error("Sign-in did not return a session. Please try again."),
      };

    // Supabase returns ordinary { error } results as well as thrown failures.
    // setSession verifies with Auth (or refreshes an expired token) before it
    // returns. Keep the account's existing verified-email/identity policy here.
    const { data, error } = await supabase.auth.setSession(tokens);
    if (error) return { status: "error", error };
    if (
      !data.session?.user?.id ||
      !data.session.access_token ||
      !verifiedPhotographer(data.user, data.session.user.id)
    )
      return {
        status: "error",
        error: new Error("Sign-in could not verify your account session. Please try again."),
      };
    return { status: "authenticated" };
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof Error ? error : new Error("Sign-in could not finish. Please try again."),
    };
  }
}
