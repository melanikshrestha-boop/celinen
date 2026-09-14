import { FormEvent, useState } from "react";
import { recordSignup } from "@/utils/payments.functions";
import { consentFromCookie } from "@/lib/marketing-consent";

async function captureWaitlistJoined(sports: boolean) {
  if (consentFromCookie(document.cookie) !== "accepted") return;
  const key = import.meta.env["VITE_POSTHOG_KEY"];
  const host = import.meta.env["VITE_POSTHOG_HOST"] || "https://us.i.posthog.com";
  const enabled = import.meta.env["VITE_POSTHOG_ENABLED"];
  if (enabled !== "true" || typeof key !== "string" || !/^phc_[A-Za-z0-9]+$/.test(key)) return;
  let distinctId = sessionStorage.getItem("celinen_waitlist_did");
  if (!distinctId) {
    distinctId = crypto.randomUUID();
    sessionStorage.setItem("celinen_waitlist_did", distinctId);
  }
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      body: JSON.stringify({
        api_key: key,
        event: "waitlist_joined",
        distinct_id: distinctId,
        properties: {
          sports: sports ? 1 : 0,
          $lib: "celinen-waitlist",
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    /* analytics must never block signup */
  }
}

export function WaitlistCta() {
  const [email, setEmail] = useState("");
  const [sports, setSports] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "saving") return;
    setStatus("saving");
    setMessage("");
    try {
      const result = await recordSignup({
        data: {
          email,
          plan: "waitlist",
          billing: "yearly",
          studio: sports ? "sports_photographer" : "",
        },
      });
      if ("error" in result && result.error) {
        setStatus("error");
        setMessage(result.error.includes("duplicate") || result.error.includes("unique")
          ? "You’re already on the list."
          : "Couldn’t save that email. Try again.");
        return;
      }
      void captureWaitlistJoined(sports);
      setStatus("done");
      setMessage("You’re on the list. We’ll reach out soon.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Couldn’t save that email. Try again.");
    }
  }

  return (
    <section className="marketing-waitlist" aria-labelledby="waitlist-heading" data-reveal>
      <div className="marketing-waitlist__copy">
        <p className="marketing-value__eyebrow">Celinen early access</p>
        <h2 id="waitlist-heading">Same-night cull to paid gallery.</h2>
        <p>
          Join the waitlist for sports photographers. Card dump in, clients paying out —
          without the subscription stack.
        </p>
      </div>
      {status === "done" ? (
        <p className="marketing-waitlist__done" role="status">{message}</p>
      ) : (
        <form className="marketing-waitlist__form" onSubmit={onSubmit}>
          <label className="marketing-waitlist__email">
            <span className="sr-only">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "saving"}
            />
          </label>
          <label className="marketing-waitlist__sports">
            <input
              type="checkbox"
              checked={sports}
              onChange={(e) => setSports(e.target.checked)}
              disabled={status === "saving"}
            />
            <span>I’m a sports photographer</span>
          </label>
          <button
            type="submit"
            className="marketing-action marketing-action--primary"
            disabled={status === "saving"}
          >
            {status === "saving" ? "Joining…" : "Get early access"}
          </button>
          {status === "error" ? (
            <p className="marketing-waitlist__error" role="alert">{message}</p>
          ) : null}
        </form>
      )}
    </section>
  );
}
