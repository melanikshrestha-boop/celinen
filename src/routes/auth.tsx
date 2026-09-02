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
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search['next'] === "string" ? (search['next'] as string) : "/shoot",
  }),
  component: AuthPage,
});

function safePath(p: string) {
  return p.startsWith("/") && !p.startsWith("//") ? p : "/shoot";
}

function AuthPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
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

  const magicLink = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="grid min-h-screen place-items-center px-6 py-16 text-ink">
      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center text-center">
          <LogoMark className="text-ink" />
          <h1 className="mt-6 font-display text-[26px] font-semibold tracking-tight">
            Sign in to LensLabs
          </h1>
          <p className="mt-1.5 text-[13px] text-moss">Beta access. Then go shoot.</p>
        </div>

        <div className="mt-8 space-y-3">
          <button
            onClick={() => void google()}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-paper2 transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            <GoogleGlyph />
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={(e) => void magicLink(e)} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[14px] outline-none placeholder:text-moss focus:border-ink/40"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="w-full rounded-lg border border-input px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "email" ? "Sending…" : "Continue with email"}
            </button>
          </form>

          {note && <p className="text-center text-[13px] text-moss">{note}</p>}
          {error && <p className="text-center text-[13px] text-rust">{error}</p>}
        </div>

        <p className="mt-8 text-center text-[12px] leading-relaxed text-moss">
          By continuing you agree to the beta terms. Your photos never leave your machine.
        </p>
        <p className="mt-4 text-center text-[12px] text-moss">
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
