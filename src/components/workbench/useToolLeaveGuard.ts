import { useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAccount } from "@/components/account/AccountProvider";

/** Tool tabs are navigation, not background jobs. Protect work before unmounting. */
export function useToolLeaveGuard(risk: string | null, beforeLeave?: () => Promise<boolean>) {
  const register = useAccount()?.registerLeaveGuard;
  useEffect(
    () =>
      register?.(async () => {
        if (risk) throw new Error("Finish or save this tool's pending work before signing out.");
        if (beforeLeave && !(await beforeLeave()))
          throw new Error("The latest review could not be saved. Stay signed in and retry.");
        return true;
      }),
    [register, risk, beforeLeave],
  );
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (
        current.pathname === next.pathname &&
        JSON.stringify(current.search) === JSON.stringify(next.search)
      )
        return false;
      if (risk && !window.confirm(`${risk}\n\nLeave this tool?`)) return true;
      if (beforeLeave && !(await beforeLeave()))
        return !window.confirm(
          "The latest review could not be saved. Leave without saving these changes?",
        );
      return false;
    },
    enableBeforeUnload: () => Boolean(risk),
  });
}
