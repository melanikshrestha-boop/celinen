import { Link } from "@tanstack/react-router";
import { APPLICATION_ORIGIN, applicationUrl } from "@/lib/application-origin";
import { ArrowRight, Camera, Eye, EyeOff, Images, Send, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { signInWithOAuth } from "@/lib/auth/oauth";
import { supabase } from "@/integrations/supabase/client";
import { authReturnUrl, isLocalAuthOrigin, type AuthSearch } from "@/lib/auth-flow";
import { safeSignInPath } from "@/lib/workbench";
import { PRODUCT_NAME } from "@/lib/product";
import { noteCompletedSignup } from "@/lib/product-lifecycle";
import { consentFromCookie } from "@/lib/marketing-consent";
import "./auth-screen.css";

type Props = AuthSearch & { onAuthenticated: () => void };

/** Real account entry; the appearance is independent of the workspace theme. */
export function AuthScreen({ next, mode, source, google, onAuthenticated }: Props) {
  const signup = mode !== "signin";
  const fromGallery = source === "client-gallery";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"google" | "email" | "password" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [localGoogle, setLocalGoogle] = useState(false);
  const [ready, setReady] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const requestPending = useRef(false);
  const mounted = useRef(false);
  const googleStarted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    setReady(true);
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    // State alone does not prevent two submissions in the same event turn.
    if (!ready || requestPending.current) return;
    requestPending.current = true;
    setBusy(kind);
    setError("");
    setNote("");
    setLocalGoogle(false);
    try {
      await action();
    } catch {
      if (mounted.current) setError("We couldn’t connect. Check your connection and try again.");
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  function providerError(message: string) {
    if (mounted.current) setError(message);
  }

  function googleSignIn() {
    void run("google", async () => {
      if (isLocalAuthOrigin(window.location.origin)) {
        setLocalGoogle(true);
        setError(
          "Google sign-in isn’t connected to this local preview. Use email here, or continue on the live website with Google.",
        );
        return;
      }
      const result = await signInWithOAuth("google", {
        redirect_uri: authReturnUrl(
          window.location.origin,
          next,
          fromGallery,
          signup ? "signup" : "signin",
        ),
      });
      if (result.status === "error")
        return providerError(
          result.error.message || "Google sign-in didn’t finish. Please try again.",
        );
      if (result.status === "authenticated" && mounted.current) onAuthenticated();
    });
  }

  useEffect(() => {
    if (!ready || !google || googleStarted.current) return;
    if (typeof window !== "undefined" && isLocalAuthOrigin(window.location.origin)) return;
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    // Returning from Google: let Supabase restore the session. Do not start another chooser.
    if (
      params.has("code") ||
      params.has("error") ||
      hash.includes("access_token") ||
      hash.includes("refresh_token") ||
      hash.includes("error")
    )
      return;
    googleStarted.current = true;
    googleSignIn();
  }, [ready, google]);

  function magicLink() {
    // Validate only email, not the password or optional sign-up fields.
    if (!emailInput.current?.reportValidity()) return;
    const recipient = email.trim();
    void run("email", async () => {
      const result = await supabase.auth.signInWithOtp({
        email: recipient,
        options: {
          emailRedirectTo: authReturnUrl(window.location.origin, next, fromGallery),
          shouldCreateUser: signup,
          ...(signup && name.trim() ? { data: { full_name: name.trim() } } : {}),
        },
      });
      if (result.error) return providerError(result.error.message);
      if (mounted.current)
        setNote(`Check ${recipient} for your sign-in link. Open it in this browser to continue.`);
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (signup && !name.trim()) {
      setError("Enter your full name to create your account.");
      return;
    }
    const recipient = email.trim();
    void run("password", async () => {
      if (signup) {
        const result = await supabase.auth.signUp({
          email: recipient,
          password,
          options: {
            emailRedirectTo: authReturnUrl(window.location.origin, next, fromGallery),
            data: { full_name: name.trim() },
          },
        });
        if (result.error) return providerError(result.error.message);
        if (result.data.user?.identities?.length)
          noteCompletedSignup(
            result.data.user.id,
            consentFromCookie(document.cookie) === "accepted",
          );
        if (!mounted.current) return;
        setPassword("");
        setShowPassword(false);
        if (result.data.session) onAuthenticated();
        else
          setNote(
            `Check ${recipient} to confirm your email. If you already have an account, choose Sign in above.`,
          );
      } else {
        const result = await supabase.auth.signInWithPassword({ email: recipient, password });
        if (result.error)
          return providerError(
            result.error.message.toLowerCase().includes("invalid login")
              ? "That email and password don’t match. Try again, or email yourself a sign-in link below."
              : result.error.message,
          );
        if (mounted.current) onAuthenticated();
      }
    });
  }

  const switchSearch: AuthSearch = {
    next: safeSignInPath(next),
    mode: signup ? "signin" : "signup",
    ...(source ? { source } : {}),
  };
  return (
    <main className="auth-screen">
      <div className="auth-scene">
        <img
          className="auth-scene-image"
          src="/images/celinen-open-sky.webp"
          alt=""
          aria-hidden="true"
          fetchPriority="high"
        />
        <Link to="/" className="auth-brand" aria-label={`${PRODUCT_NAME} home`}>
          {PRODUCT_NAME}
        </Link>
        <h1>
          Send the gallery <em>tonight</em>
        </h1>
        <p className="auth-scene-plan">Hobby · USD 16 / mo billed yearly · 1,000 photo credits / mo</p>
        <ul className="auth-scene-points">
          <li>
            <Camera size={18} strokeWidth={1.8} aria-hidden="true" />
            Import a shoot
          </li>
          <li>
            <Images size={18} strokeWidth={1.8} aria-hidden="true" />
            Pick the keepers
          </li>
          <li>
            <Send size={18} strokeWidth={1.8} aria-hidden="true" />
            Send a gallery
          </li>
          <li>
            <SlidersHorizontal size={18} strokeWidth={1.8} aria-hidden="true" />
            Adobe when you want it
          </li>
        </ul>
      </div>
      <section className="auth-panel" aria-labelledby="auth-title">
        <Link to="/" className="auth-leave">
          Back
        </Link>
        <p className="auth-wordmark">{PRODUCT_NAME}</p>
        <header className="auth-heading">
          <h1 id="auth-title">
            {signup ? (
              <>
                Create an <em>account</em>
              </>
            ) : (
              <>
                Sign <em>in</em>
              </>
            )}
          </h1>
        </header>

        <button
          className="auth-google"
          type="button"
          onClick={googleSignIn}
          disabled={!ready || busy !== null}
        >
          <GoogleGlyph />
          {busy === "google" ? "Connecting…" : "Continue with Google"}
        </button>

        <form className="auth-form" onSubmit={submit} aria-busy={busy !== null}>
          <fieldset disabled={!ready || busy !== null}>
            {signup && (
              <label htmlFor="auth-name">
                Full name
                <input
                  id="auth-name"
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Hale"
                />
              </label>
            )}
            <label htmlFor="auth-email">
              Email address
              <input
                ref={emailInput}
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jordan@studio.com"
              />
            </label>
            <label htmlFor="auth-password">Password</label>
            <div className="auth-password">
              <input
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={signup ? "new-password" : "current-password"}
                required
                minLength={signup ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={signup ? "Create a password" : "Enter your password"}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <button className="auth-submit" type="submit">
              {busy === "password" ? (signup ? "Creating your account…" : "Signing in…") : "Continue"}
            </button>
          </fieldset>
        </form>

        <div className="auth-feedback" aria-live="polite" aria-atomic="true">
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          {localGoogle && (
            <a
              className="auth-live-link"
              href={applicationUrl(
                `/auth?${new URLSearchParams({ next: safeSignInPath(next), mode: signup ? "signup" : "signin", ...(source ? { source } : {}) })}`,
              )}
            >
              Continue on {new URL(APPLICATION_ORIGIN).hostname} <ArrowRight size={16} />
            </a>
          )}
          {note && <p role="status">{note}</p>}
        </div>
        {!signup && (
          <button
            type="button"
            className="auth-magic"
            disabled={!ready || busy !== null}
            onClick={magicLink}
          >
            {busy === "email" ? "Sending your link…" : "Email me a sign-in link instead"}
          </button>
        )}
        <p className="auth-switch">
          {signup ? "Already have an account?" : `New to ${PRODUCT_NAME}?`}{" "}
          <Link
            to="/auth"
            search={switchSearch}
            aria-disabled={busy !== null}
            onClick={(event) => {
              if (requestPending.current) event.preventDefault();
            }}
          >
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
        <p className="auth-legal">
          By continuing, you agree to our <Link to="/terms">Terms of Service</Link> and{" "}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <footer className="auth-footer">
          {fromGallery ? (
            <p>
              Your private gallery is still open in the original tab. You don’t need this account to
              receive your photos.
            </p>
          ) : (
            <>
              <span>Viewing a gallery?</span>
              <Link to="/portal">
                Client access <ArrowRight size={16} />
              </Link>
            </>
          )}
        </footer>
        <noscript>
          <p className="auth-error">Enable JavaScript to securely sign in to {PRODUCT_NAME}.</p>
        </noscript>
      </section>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
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
