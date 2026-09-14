import { useEffect } from "react";
import { useAccount } from "./AccountProvider";
import { createProductAnalytics } from "@/lib/product-analytics";
import { consentFromCookie } from "@/lib/marketing-consent";
import {
  connectProductAnalytics,
  emitCompletedSignup,
  revokeProductAnalytics,
} from "@/lib/product-lifecycle";

/** No rendered UI. Account UUID only: never pass the user/profile/session object. */
export function ProductAnalytics() {
  const account = useAccount();
  const accountId = account?.status === "in" && !account.local ? account.scope : null;
  useEffect(() => {
    if (!accountId) return;
    let client: ReturnType<typeof createProductAnalytics> | undefined;
    let disconnect: (() => void) | undefined;
    const reconcile = () => {
      if (consentFromCookie(document.cookie) !== "accepted") {
        revokeProductAnalytics();
        disconnect?.();
        client = undefined;
        return;
      }
      if (client) return;
      client = createProductAnalytics({
        config: {
          enabled: import.meta.env["VITE_POSTHOG_ENABLED"],
          key: import.meta.env["VITE_POSTHOG_KEY"],
          host: import.meta.env["VITE_POSTHOG_HOST"],
        },
        accountId,
        cookie: () => document.cookie,
        fetch: (url, init) => fetch(url, init),
      });
      disconnect = connectProductAnalytics(
        accountId,
        client,
        () => consentFromCookie(document.cookie) === "accepted",
      );
      void client.capture("app_opened");
      emitCompletedSignup(accountId);
    };
    reconcile();
    window.addEventListener("foto-consent-changed", reconcile);
    window.addEventListener("focus", reconcile);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("foto-analytics-consent");
      channel.onmessage = reconcile;
    } catch {
      /* Cookie is also checked at every send. */
    }
    return () => {
      disconnect?.();
      channel?.close();
      window.removeEventListener("foto-consent-changed", reconcile);
      window.removeEventListener("focus", reconcile);
    };
  }, [accountId]);
  return null;
}
