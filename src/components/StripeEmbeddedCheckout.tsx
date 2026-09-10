import { useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCheckoutSession } from "@/utils/payments.functions";

interface Props {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  returnUrl?: string;
}

export function StripeEmbeddedCheckout({ priceId, quantity, customerEmail, returnUrl }: Props) {
  const [error, setError] = useState<string | null>(null);

  const fetchClientSecret = async (): Promise<string> => {
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
      if (!result.clientSecret) throw new Error("Checkout did not return a client secret");
      return result.clientSecret;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Checkout failed";
      setError(/not configured/i.test(message) ? "Checkout is not live on this machine." : message);
      throw caught;
    }
  };

  if (error) return <p className="pricing-checkout-error">{error}</p>;

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
