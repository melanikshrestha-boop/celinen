import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { consentCookie, consentFromCookie, type Consent } from "@/lib/marketing-consent";
import "./cookie-consent.css";

function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  return consentFromCookie(document.cookie);
}

function writeConsent(value: Consent) {
  document.cookie = consentCookie(value);
}

async function track(path: string) {
  if (readConsent() !== "accepted") return;
  await fetch("/api/public/traffic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      referrer: typeof document === "undefined" ? "" : document.referrer,
    }),
  });
}

/** Accept records visits. Reject keeps the site working and records nothing. */
export function CookieConsent() {
  const [choice, setChoice] = useState<Consent | "pending">("pending");

  useEffect(() => {
    setChoice(readConsent() ?? "pending");
    const reopen = () => setChoice("pending");
    window.addEventListener("foto-cookie-prefs", reopen);
    return () => window.removeEventListener("foto-cookie-prefs", reopen);
  }, []);

  useEffect(() => {
    if (choice !== "accepted") return;
    let last = "";
    const send = () => {
      const path = window.location.pathname;
      if (path === last) return;
      last = path;
      void track(path);
    };
    send();
    const later = () => window.setTimeout(send, 40);
    document.addEventListener("click", later);
    window.addEventListener("popstate", send);
    return () => {
      document.removeEventListener("click", later);
      window.removeEventListener("popstate", send);
    };
  }, [choice]);

  const decide = (value: Consent) => {
    writeConsent(value);
    setChoice(value);
  };

  if (choice !== "pending") return null;

  return (
    <div className="marketing-cookies" role="dialog" aria-label="Cookies">
      <p>
        We use cookies for analytics to understand how celinen is used. See the{" "}
        <Link to="/cookie-policy">Cookie Policy</Link>
        .
      </p>
      <div className="marketing-cookies__actions">
        <button type="button" className="marketing-cookies__reject" onClick={() => decide("rejected")}>
          Reject
        </button>
        <button type="button" className="marketing-cookies__accept" onClick={() => decide("accepted")}>
          Accept
        </button>
      </div>
    </div>
  );
}
