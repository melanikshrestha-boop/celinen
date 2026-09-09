import type { ReactNode } from "react";
import type { DeliveryFocus } from "@/lib/delivery/studio-handoff";
import { developWorkspaceHref } from "@/lib/workbench-projects";
import "./delivery-version-boundary.css";

/** Delivery references cannot mount either the native editor or a hidden legacy controller. */
export function DeliveryVersionBoundary({
  projectId,
  shootId,
  deliveryFocus,
  children,
}: {
  projectId: string | null;
  shootId?: string;
  deliveryFocus?: DeliveryFocus;
  children: ReactNode;
}) {
  if (!deliveryFocus) return children;
  let workingHref: string | null = null;
  try {
    if (projectId && !shootId && deliveryFocus.frameId.trim())
      workingHref = developWorkspaceHref(
        { kind: "ready", projectId },
        `studio:${deliveryFocus.frameId}`,
      );
  } catch {
    // A malformed reference must not open an unrelated library or bypass this boundary.
  }
  return (
    <section className="foto-develop develop-loading develop-delivery-boundary">
      <h1>Exact Version Not Available in Develop</h1>
      <p role="alert">
        This link requests delivery version <code>{deliveryFocus.versionId}</code>. Develop cannot
        open that exact saved treatment yet. No different version has been opened or exported.
      </p>
      <p>Your delivery files, original photo, and edit history are unchanged.</p>
      {workingHref && (
        <>
          {/* Full navigation deliberately clears remembered delivery context. */}
          <a data-working-edit="true" href={workingHref}>
            Open Current Working Edit
          </a>
          <small>
            This leaves the requested delivery version and opens this photo’s working edit.
          </small>
        </>
      )}
    </section>
  );
}
