import { useEffect, useRef, useState } from "react";
import { getStripeEnvironment } from "@/lib/stripe";
import { createCheckoutSession } from "@/utils/payments.functions";

interface Props {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  returnUrl?: string;
}

/** Hosted Stripe Checkout (Link, promo codes, subscribe). Same surface Vugola uses. */
export function StripeEmbeddedCheckout({ priceId, quantity, customerEmail, returnUrl }: Props) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const result = await createCheckoutSession({
          data: {
            priceId,
            ...(quantity ? { quantity } : {}),
            ...(customerEmail ? { customerEmail } : {}),
            returnUrl: returnUrl || window.location.href,
            environment: getStripeEnvironment(),
          },
        });
        if ("error" in result) throw new Error(result.error);
        if (!result.url) throw new Error("Checkout did not return a URL");
        window.location.assign(result.url);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Checkout failed";
        if (/not configured/i.test(message)) {
          window.location.assign("/auth?mode=signup&next=/studio");
          return;
        }
        setError(message);
      }
    })();
  }, [priceId, quantity, customerEmail, returnUrl]);

  if (error) return <p className="pricing-checkout-error">{error}</p>;

  return (
    <p className="pricing-checkout-pending" role="status">
      Taking you to secure checkout…
    </p>
  );
}
