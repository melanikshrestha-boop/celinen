import { Outlet, useLocation } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { useWorkbench } from "@/components/workbench/context";
import { ShootsHub } from "@/components/shoots/ShootsHub";
import { ShootWorkspaceFrame, ShootPlaceholder } from "@/components/shoots/ShootWorkspaceFrame";
import { DevelopPage } from "@/components/develop/DevelopPage";
import { DeliveryWorkspace } from "@/components/delivery/DeliveryWorkspace";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { canonicalShootBinding, shootRoute } from "@/lib/workbench-projects";
import { Studio } from "./studio";

function useShootRoute() {
  const account = useAccount(),
    workbench = useWorkbench();
  const href = useLocation({ select: (location) => location.href });
  return {
    scope: workbench?.storageScope ?? account?.scope,
    workbench,
    route: shootRoute(href),
    binding: canonicalShootBinding(href, isLocalSingleUserMode),
  };
}
export function ShootHubRoute({ view }: { view: "tonight" | "shoots" | "library" }) {
  const account = useAccount(),
    workbench = useWorkbench();
  const scope = workbench?.storageScope ?? account?.scope;
  return scope ? (
    <ShootsHub scope={scope} view={view} includeLocalProjects={isLocalSingleUserMode} />
  ) : (
    <p role="status">Opening your workspace…</p>
  );
}
export function ShootFrameRoute() {
  const { scope, route, binding } = useShootRoute();
  if (!scope) return <p role="status">Opening your workspace…</p>;
  if (binding?.kind === "blocked") return <p role="alert">{binding.reason}</p>;
  if (!route || !binding)
    return <p role="alert">This shoot link is invalid. No photos were opened.</p>;
  return (
    <ShootWorkspaceFrame
      key={JSON.stringify([scope, route.key])}
      scope={scope}
      shootKey={route.key}
      tab={route.tab}
      includeLocalProjects={isLocalSingleUserMode}
    >
      <Outlet />
    </ShootWorkspaceFrame>
  );
}
export function ShootCullRoute() {
  const { scope, workbench, binding } = useShootRoute();
  // Workbench owns the persistent Cull controller and its dirty/save guards.
  if (workbench) return null;
  if (!scope || !binding) return <p role="status">Opening your shoot…</p>;
  if (binding.kind === "blocked") return <p role="alert">{binding.reason}</p>;
  return (
    <Studio
      key={JSON.stringify([scope, binding])}
      storageScope={scope}
      projectId={binding.projectId}
      {...(binding.shootId ? { shootId: binding.shootId } : {})}
      {...(binding.deliveryFocus ? { deliveryFocus: binding.deliveryFocus } : {})}
    />
  );
}
export function ShootDevelopRoute() {
  const { scope, binding } = useShootRoute();
  if (!scope || !binding) return <p role="status">Opening your shoot…</p>;
  if (binding.kind === "blocked") return <p role="alert">{binding.reason}</p>;
  return (
    <DevelopPage
      key={JSON.stringify([scope, binding.projectId, binding.shootId])}
      scope={scope}
      projectId={binding.projectId}
      {...(binding.shootId ? { shootId: binding.shootId } : {})}
    />
  );
}
export function ShootGalleryRoute() {
  // The existing gallery desk is shared, not yet automatically bound to a directory shoot.
  return (
    <>
      <p className="shoot-module-note">
        Shared gallery desk. Choose the gallery for this shoot; nothing is sent automatically.
      </p>
      <DeliveryWorkspace />
    </>
  );
}
export function ShootSocialRoute() {
  return <ShootPlaceholder tab="social" />;
}
export function ShootSmartFileRoute() {
  return <ShootPlaceholder tab="smart-file" />;
}
