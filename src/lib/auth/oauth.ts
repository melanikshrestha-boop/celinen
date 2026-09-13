import { supabase } from "@/integrations/supabase/client";

export type OAuthProvider = "google";
export type SignInWithOAuthOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};
export type OAuthSignInResult =
  | { status: "redirected" }
  | { status: "authenticated" }
  | { status: "error"; error: Error };

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Google via Supabase Auth. Never Lovable's oauth.lovable.app grant screen. */
export async function signInWithOAuth(
  provider: OAuthProvider,
  options?: SignInWithOAuthOptions,
): Promise<OAuthSignInResult> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: options?.redirect_uri,
        skipBrowserRedirect: true,
        queryParams: {
          prompt: "select_account",
          ...options?.extraParams,
        },
      },
    });
    if (error) return { status: "error", error };
    const url = data?.url;
    if (!url || typeof url !== "string" || !isHttpsUrl(url))
      return {
        status: "error",
        error: new Error("Sign-in did not return a session. Please try again."),
      };
    if (/lovable\.(app|dev)/i.test(url))
      return {
        status: "error",
        error: new Error("Google sign-in is misconfigured. Use email, or try again later."),
      };
    if (typeof window !== "undefined" && typeof window.location?.assign === "function")
      window.location.assign(url);
    return { status: "redirected" };
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof Error ? error : new Error("Sign-in could not finish. Please try again."),
    };
  }
}
