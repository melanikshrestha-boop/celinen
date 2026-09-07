import { useAccount } from "@/components/account/AccountProvider";

export type SessionState = "loading" | "in" | "out";

export function useSessionState(): SessionState {
  return useAccount()?.status ?? "loading";
}
