import { ArrowUpRight } from "lucide-react";
import { LogoMark } from "@/components/lensos/Logo";
import { galleryPresentation } from "@/lib/delivery/gallery-presentation";
import { gallerySignupPath } from "@/lib/delivery/experience";
import { selectionsLocked, type DeliveryState } from "@/lib/delivery/workflow";

export function ClientGalleryHeader({ state }: { state: DeliveryState }) {
  const { studioName } = galleryPresentation(state);
  return (
    <header className="delivery-client-header">
      <p className="delivery-studio-name">{studioName || "Your photographer"}</p>
      <p className="delivery-eyebrow">Photographs for {state.clientName}</p>
      <h1>{state.title}</h1>
      <p>Private gallery · available until {new Date(state.expiresAt).toLocaleDateString()}</p>
    </header>
  );
}

export function ClientGalleryFooter({
  state,
  preview = false,
}: {
  state: DeliveryState;
  preview?: boolean;
}) {
  const { showLensLabsCredit } = galleryPresentation(state);
  return (
    <footer className="delivery-client-footer">
      <p>
        Keep this invitation private. Everyone with the link shares selections and feedback. Your
        photographer sees comments here; email notifications are not enabled. Save final files
        before the gallery expires.
      </p>
      {showLensLabsCredit && (
        <div className="delivery-attribution">
          <span>
            <LogoMark size={20} /> Delivered with LensLabs
          </span>
          {selectionsLocked(state) &&
            (preview ? (
              <span>Photographer? Deliver your own work ↗</span>
            ) : (
              <a
                href={gallerySignupPath}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Photographer? Deliver your own work <ArrowUpRight size={15} />
              </a>
            ))}
        </div>
      )}
    </footer>
  );
}
