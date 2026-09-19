import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  SALES_HEADCOUNT,
  SALES_PRODUCTS,
  type SalesInquiryDraft,
} from "@/lib/sales-inquiry";
import { PRODUCT_EMAIL } from "@/lib/product";
import "./sales-contact.css";

const EMPTY: SalesInquiryDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  company: "",
  website: "",
  product: "",
  headcount: "",
  usage: "",
  needs: "",
  fax: "",
};

export function SalesContact({ heading = "h1" }: { heading?: "h1" | "h2" }) {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const Title = heading;

  function set<K extends keyof SalesInquiryDraft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/public/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not send.");
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marketing-sales">
      <div className="marketing-sales__intro">
        <p className="marketing-value__eyebrow">Sales</p>
        <Title id="contact-sales">Contact sales</Title>
        {sent ? (
          <p>Sent. We’ll write back at {draft.email}.</p>
        ) : (
          <p>
            Running a smaller team?{" "}
            <Link to="/auth" search={{ mode: "signup", next: "/dashboard" }}>
              Use Celinen
            </Link>
          </p>
        )}
      </div>
      {sent ? null : (
        <form className="marketing-sales__form" onSubmit={(event) => void onSubmit(event)}>
          <label className="marketing-sales__hp" aria-hidden="true">
            Fax
            <input
              value={draft.fax}
              tabIndex={-1}
              autoComplete="off"
              onChange={(event) => set("fax", event.target.value)}
            />
          </label>
          <label>
            First name
            <input
              required
              autoComplete="given-name"
              value={draft.firstName}
              onChange={(event) => set("firstName", event.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              required
              autoComplete="family-name"
              value={draft.lastName}
              onChange={(event) => set("lastName", event.target.value)}
            />
          </label>
          <label className="marketing-sales__wide">
            Work email
            <input
              required
              type="email"
              autoComplete="email"
              value={draft.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              autoComplete="tel"
              value={draft.phone}
              onChange={(event) => set("phone", event.target.value)}
            />
          </label>
          <label>
            Job title
            <input
              autoComplete="organization-title"
              value={draft.jobTitle}
              onChange={(event) => set("jobTitle", event.target.value)}
            />
          </label>
          <label>
            Company
            <input
              required
              autoComplete="organization"
              value={draft.company}
              onChange={(event) => set("company", event.target.value)}
            />
          </label>
          <label>
            Website
            <input
              type="url"
              autoComplete="url"
              value={draft.website}
              onChange={(event) => set("website", event.target.value)}
            />
          </label>
          <label className="marketing-sales__wide">
            Product
            <select
              required
              value={draft.product}
              onChange={(event) => set("product", event.target.value)}
            >
              <option value="">Select</option>
              {SALES_PRODUCTS.map((product) => (
                <option key={product} value={product}>
                  {product}
                </option>
              ))}
            </select>
          </label>
          <label>
            Headcount
            <select
              required
              value={draft.headcount}
              onChange={(event) => set("headcount", event.target.value)}
            >
              <option value="">Select size</option>
              {SALES_HEADCOUNT.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expected usage
            <input
              value={draft.usage}
              onChange={(event) => set("usage", event.target.value)}
            />
          </label>
          <label className="marketing-sales__wide">
            What you need
            <textarea
              required
              rows={5}
              value={draft.needs}
              onChange={(event) => set("needs", event.target.value)}
            />
          </label>
          {error ? (
            <p className="marketing-sales__error" role="alert">
              {error} Email {PRODUCT_EMAIL} if this keeps failing.
            </p>
          ) : null}
          <button type="submit" disabled={busy}>
            Contact sales
          </button>
        </form>
      )}
    </div>
  );
}
