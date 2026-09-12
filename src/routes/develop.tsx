import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { useWorkbench } from "@/components/workbench/context";
import { explicitWorkspaceBinding } from "@/lib/workbench-projects";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { DevelopPage } from "@/components/develop/DevelopPage";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/develop")({
  head: () => ({ meta: [{ title: `Develop — ${PRODUCT_NAME}` }] }),
  component: DevelopRoute,
});

function DevelopRoute() {
  const account = useAccount(),
    workbench = useWorkbench(),
    href = useLocation({ select: (location) => location.href });
  const binding = explicitWorkspaceBinding(href, isLocalSingleUserMode);
  if (binding?.kind === "blocked") return <p role="alert">{binding.reason}</p>;
  if (!account?.scope) return <p>Opening your workspace…</p>;
  const scope = workbench?.storageScope ?? account.scope;
  const project = binding?.projectId ?? workbench?.workspaceProjectId ?? null;
  const shoot = binding?.kind === "ready" ? binding.shootId : undefined;
  const deliveryFocus = binding?.kind === "ready" ? binding.deliveryFocus : undefined;
  return (
    <DevelopPage
      key={JSON.stringify([scope, project, shoot])}
      scope={scope}
      projectId={project}
      {...(shoot ? { shootId: shoot } : {})}
      {...(deliveryFocus ? { deliveryFocus } : {})}
    />
  );
}
