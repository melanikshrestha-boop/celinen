import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useWorkbench } from "@/components/workbench/context";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { legacyWorkbenchRedirect } from "@/lib/workbench-projects";

export function LegacyWorkbenchRedirect() {
  const href = useLocation({ select: (location) => location.href });
  const navigate = useNavigate(),
    workspace = useWorkbench();
  const [error, setError] = useState("");
  const remembered = workspace
    ? {
        kind: "ready" as const,
        projectId: workspace.workspaceProjectId,
        ...(workspace.workspaceShootId ? { shootId: workspace.workspaceShootId } : {}),
        ...(workspace.workspaceDeliveryFocus
          ? { deliveryFocus: workspace.workspaceDeliveryFocus }
          : {}),
      }
    : null;
  const result = legacyWorkbenchRedirect(href, remembered, isLocalSingleUserMode);
  const destination = result && "href" in result ? result.href : null;
  useEffect(() => {
    if (!destination) return;
    setError("");
    void navigate({ href: destination, replace: true }).catch(() =>
      setError("This page could not be opened. Your saved work is unchanged."),
    );
  }, [destination, navigate]);
  if (result && "blocked" in result) return <p role="alert">{result.blocked}</p>;
  return <p role={error ? "alert" : "status"}>{error || "Opening your workspace…"}</p>;
}
