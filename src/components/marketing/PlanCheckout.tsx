import { useState } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";

type Cycle = "monthly" | "yearly";

function paymentsPublishable(): boolean {
  const token = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;
  return Boolean(token?.startsWith("pk_"));
}

/** Stripe collects email and card. Do not add a second form in front of it. */
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

  if (open && paymentsPublishable()) {
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
