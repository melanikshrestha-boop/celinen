import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in to LensLabs — beta access" },
      {
        name: "description",
        content:
          "Sign in with Google to open the LensLabs shoot bar: drop a shoot, auto-cull to keepers, send to Lightroom with XMP.",
      },
      { property: "og:title", content: "Sign in to LensLabs" },
      {
        property: "og:description",
        content: "Google sign-in for beta photographers. One click, then go shoot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { next: string; mode?: "signin" | "signup" } => ({
    next: typeof search['next'] === "string" ? (search['next'] as string) : "/shoot",
    ...(search['mode'] === "signup" ? { mode: "signup" as const } : {}),
  }),
  component: AuthPage,
});

function safePath(p: string) {
  return p.startsWith("/") && !p.startsWith("//") ? p : "/shoot";
}

function AuthPage() {
  const { next, mode } = Route.useSearch();
  const navigate = useNavigate();
  const signup = mode === "signup";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<"google" | "email" | "password" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive && data.user) void navigate({ to: safePath(next), replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") void navigate({ to: safePath(next), replace: true });
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate, next]);

  const google = async () => {
    setError(null);
    setBusy("google");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setError(result.error.message ?? "Google sign-in failed.");
      setBusy(null);
      return;
    }
    if (result.redirected) return;
    void navigate({ to: safePath(next), replace: true });
  };

  const magicLink = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setBusy("email");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}${safePath(next)}` },
    });
    setBusy(null);
    if (err) setError(err.message);
    else setNote(`Link sent to ${email.trim()}. Open it on this device.`);
  };

  const withPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || password.length < 8) return;
    setError(null);
    setNote(null);
    setBusy("password");
    if (signup) {
      const { data: res, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${safePath(next)}`,
          data: { full_name: name.trim() || null },
        },
      });
      setBusy(null);
      if (err) {
        setError(
          err.message.toLowerCase().includes("weak")
            ? "That password shows up in known breach lists. Pick something less guessable."
            : err.message,
        );
        return;
      }
      if (res.session) {
        void navigate({ to: safePath(next), replace: true });
        return;
      }
      setNote(`Account created for ${email.trim()}. Confirm the email we just sent.`);
      return;
    }
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(null);
    if (err)
      setError(
        err.message.toLowerCase().includes("invalid login")
          ? "That email and password don't match an account. Create one on the Sign up tab."
          : err.message,
      );
  };

  return (
    <div className="grid min-h-screen place-items-center px-6 py-16 text-ink">
      <div className="w-full max-w-[420px]">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="flex flex-col items-center text-center">
            <LogoMark className="text-ink" />
            <h1 className="mt-5 font-display text-[26px] font-semibold tracking-tight">
              {signup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1.5 text-[13px] text-moss">
              One account for every LensLabs shoot. Go create more.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <Link
              to="/auth"
              search={{ next, mode: "signin" }}
              className={`rounded-md py-1.5 text-center text-[13px] font-medium transition-colors ${
                signup ? "text-moss hover:text-ink" : "bg-card text-ink shadow-sm"
              }`}
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              search={{ next, mode: "signup" }}
              className={`rounded-md py-1.5 text-center text-[13px] font-medium transition-colors ${
                signup ? "bg-card text-ink shadow-sm" : "text-moss hover:text-ink"
              }`}
            >
              Sign up
            </Link>
          </div>

          <button
            onClick={() => void google()}
            disabled={busy !== null}
            className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-lg border border-input px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <GoogleGlyph />
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 py-4">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={(e) => void withPassword(e)} className="space-y-3">
            {signup && (
              <label className="block">
                <span className="text-[13px] font-medium">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                  className="mt-1.5 w-full rounded-lg border border-input bg-paper2 px-3.5 py-2.5 text-[14px] outline-none placeholder:text-moss focus:border-rust/50"
                />
              </label>
            )}

            <label className="block">
              <span className="text-[13px] font-medium">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                className="mt-1.5 w-full rounded-lg border border-input bg-paper2 px-3.5 py-2.5 text-[14px] outline-none placeholder:text-moss focus:border-rust/50"
              />
            </label>

            <label className="block">
              <span className="text-[13px] font-medium">Password</span>
              <div className="relative mt-1.5">
                <input
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full rounded-lg border border-input bg-paper2 px-3.5 py-2.5 pr-11 text-[14px] outline-none placeholder:text-moss focus:border-rust/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-moss hover:text-ink"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={busy !== null}
              className="w-full rounded-lg bg-rust px-4 py-2.5 text-[14px] font-semibold text-paper2 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "password"
                ? signup
                  ? "Creating…"
                  : "Signing in…"
                : signup
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>

          <button
            onClick={(e) => void magicLink(e)}
            disabled={busy !== null || !email.trim()}
            className="mt-3 w-full text-center text-[13px] text-moss underline underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            {busy === "email" ? "Sending…" : "Email me a magic link instead"}
          </button>

          {note && <p className="mt-4 text-center text-[13px] text-moss">{note}</p>}
          {error && <p className="mt-4 text-center text-[13px] text-rust">{error}</p>}

          <p className="mt-5 text-center text-[12px] text-moss">
            Not a photographer?{" "}
            <Link to="/portal" className="text-rust hover:underline">
              Client login
            </Link>
          </p>

          <p className="mt-4 text-center text-[12px] leading-relaxed text-moss">
            By continuing you agree to the beta terms. Your photos never leave your machine.
          </p>
        </div>

        <p className="mt-5 text-center text-[12px] text-moss">
          {signup ? "Already have an account? " : "New to LensLabs? "}
          <Link
            to="/auth"
            search={{ next, mode: signup ? "signin" : "signup" }}
            className="text-rust hover:underline"
          >
            {signup ? "Sign in" : "Create one"}
          </Link>
          {" · "}
          <Link to="/" className="underline underline-offset-4 hover:text-ink">
            Back to LensLabs
          </Link>
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.6z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1 7.8-2.9l-3.7-2.9c-1 .7-2.3 1.2-4.1 1.2-3.1 0-5.8-2-6.7-4.9l-.14.01-3.6 2.8-.05.14C3.4 21.3 7.4 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.5c-.3-.7-.4-1.5-.4-2.5s.2-1.8.4-2.5l-.01-.17L1.6 6.5l-.12.06A12 12 0 0 0 0 12c0 1.9.5 3.8 1.5 5.4l3.8-2.9z"
      />
      <path
        fill="#EB4335"
        d="M12 4.7c2.2 0 3.7.9 4.5 1.7l3.3-3.2C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.5 6.6l3.8 2.9C6.2 6.7 8.9 4.7 12 4.7z"
      />
    </svg>
  );
}
