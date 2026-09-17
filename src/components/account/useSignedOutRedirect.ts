import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { signInHref } from "@/lib/auth-flow";

/**
 * Private pages leave for Sign In only once Auth has answered "out", so a restoring
 * session never flashes Sign In. A full navigation also drops the last account's memory.
 */
export function useSignedOutRedirect() {
  const status = useAccount()?.status;
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    if (status === "out") window.location.replace(signInHref(href));
  }, [status, href]);
}
