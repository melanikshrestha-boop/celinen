import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { paymentsAreLive } from "@/lib/payments-available";

type Cycle = "monthly" | "yearly";

/** Stripe collects email and card when configured; otherwise send people to auth. */
export function PlanCheckout({
  plan,
  billing,
  amount,
  perUser,
}: {
  plan: string;
  billing: Cycle;
  amount: number;
  perUser: boolean;
}) {
  const [open, setOpen] = useState(false);
  const priceId = `${plan}_${billing}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (!paymentsAreLive()) {
    return (
      <div className="pricing-checkout">
        <Link
          to="/auth"
          search={{ mode: "signup", next: "/studio" }}
          className="pricing-pay inline-flex items-center justify-center"
        >
          Get started free
        </Link>
      </div>
    );
  }

  if (open) {
    return (
      <div className="pricing-checkout">
        <StripeEmbeddedCheckout
          key={priceId}
          priceId={priceId}
          returnUrl={`${origin}/signup?plan=${plan}&billing=${billing}`}
        />
      </div>
    );
  }

  return (
    <div className="pricing-checkout">
      <button type="button" className="pricing-pay" onClick={() => setOpen(true)}>
        Pay · USD {amount}
        {perUser ? " / user" : ""} / mo
      </button>
    </div>
  );
}
