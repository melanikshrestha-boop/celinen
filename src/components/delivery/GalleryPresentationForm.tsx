import { useEffect, useState } from "react";
import {
  galleryPresentation,
  galleryPresentationSchema,
  sameGalleryPresentation,
  type GalleryPresentation,
} from "@/lib/delivery/gallery-presentation";
import type { DeliveryState } from "@/lib/delivery/workflow";
import { messageOf } from "./presentation";

export function GalleryPresentationForm({
  state,
  busy,
  save,
  onDirty,
}: {
  state: DeliveryState;
  busy: boolean;
  save: (value: GalleryPresentation) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const initial = galleryPresentation(state);
  const [name, setName] = useState(initial.studioName);
  const [baseline, setBaseline] = useState(initial);
  const [credit, setCredit] = useState(initial.showLensLabsCredit);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = name !== baseline.studioName || credit !== baseline.showLensLabsCredit;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return (
    <form
      className="delivery-form delivery-presentation-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSaved(false);
        try {
          if (!sameGalleryPresentation(state, { presentation: baseline }))
            throw new Error(
              "Presentation changed while these controls were open. Close and reopen them before saving.",
            );
          const value = galleryPresentationSchema.parse({
            studioName: name,
            showLensLabsCredit: credit,
          });
          await save(value);
          setName(value.studioName);
          setBaseline(value);
          setSaved(true);
        } catch (cause) {
          setError(messageOf(cause));
        }
      }}
    >
      <label>
        Photographer or studio name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={100}
          placeholder="Your name, on your work"
          disabled={busy}
        />
      </label>
      <label className="delivery-credit-choice">
        <input
          type="checkbox"
          checked={credit}
          onChange={(e) => {
            setCredit(e.target.checked);
            setSaved(false);
          }}
          disabled={busy}
        />
        <span>
          Show “Delivered with LensLabs”
          <small>
            A quiet credit below the photos. An optional photographer sign-up link appears after
            selections are submitted.
          </small>
        </span>
      </label>
      <div className="delivery-inline-actions">
        <button className="delivery-primary" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save presentation"}
        </button>
        {saved && !dirty && <span role="status">Presentation saved</span>}
      </div>
      {error && (
        <p className="delivery-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
