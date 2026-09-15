import { createFileRoute } from "@tanstack/react-router";
import { LegacyWorkbenchRedirect } from "./-legacy-redirect";
import { useAccount } from "@/components/account/AccountProvider";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { OutboundPage } from "@/components/outbound/OutboundPage";

export const Route = createFileRoute("/outbound")({
  head: () => ({
    meta: [{ title: "Outbound — Celinen" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: LegacyWorkbenchRedirect,
});

export function OutboundWorkspace() {
  const account = useAccount();
  if (!isLocalSingleUserMode)
    return <p>FOTO’s founder outreach desk is available in the private local workspace.</p>;
  if (!account?.scope) return <p>Opening outbound…</p>;
  return <OutboundPage key={account.scope} scope={account.scope} />;
}
