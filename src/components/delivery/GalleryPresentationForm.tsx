import { useEffect, useState } from "react";
import {
  galleryPresentation,
  galleryDesign,
  galleryDesignSchema,
  validateGalleryCovers,
  type GalleryDesign,
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
  const [design, setDesign] = useState(galleryDesign(state));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty =
    name !== baseline.studioName ||
    credit !== baseline.showLensLabsCredit ||
    JSON.stringify(design) !== JSON.stringify(galleryDesign({ presentation: baseline }));
  const updateDesign = (patch: Partial<GalleryDesign>) => {
    setDesign((old) => ({ ...old, ...patch }));
    setSaved(false);
  };
  const coverOptions = state.photos.flatMap((photo) =>
    photo.versions.filter(
      (v) =>
        v.ready &&
        (v.id === photo.current ||
          v.id === photo.published ||
          design.coverVersionIds.includes(v.id)),
    ),
  );
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
            design: galleryDesignSchema.parse(design),
          });
          validateGalleryCovers(state, value);
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
      <div className="delivery-form-row">
        <label>
          Gallery font
          <select
            value={design.font}
            disabled={busy}
            onChange={(e) => updateDesign({ font: e.target.value as GalleryDesign["font"] })}
          >
            <option value="inherit">Match workspace</option>
            <option value="sans">Clean sans</option>
            <option value="editorial">Editorial serif</option>
          </select>
        </label>
        <label>
          Gallery appearance
          <select
            value={design.theme}
            disabled={busy}
            onChange={(e) => updateDesign({ theme: e.target.value as GalleryDesign["theme"] })}
          >
            <option value="inherit">Match visitor theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Photo layout
          <select
            value={design.layout}
            disabled={busy}
            onChange={(e) => updateDesign({ layout: e.target.value as GalleryDesign["layout"] })}
          >
            <option value="grid">Even grid</option>
            <option value="natural">Natural proportions</option>
          </select>
        </label>
        <label>
          Photo spacing
          <select
            value={design.spacing}
            disabled={busy}
            onChange={(e) => updateDesign({ spacing: e.target.value as GalleryDesign["spacing"] })}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      </div>
      <fieldset className="delivery-cover-choices" disabled={busy}>
        <legend>Cover photos · up to three</legend>
        {[0, 1, 2].map((index) => (
          <label key={index}>
            Cover photo {index + 1}
            <select
              value={design.coverVersionIds[index] ?? ""}
              onChange={(e) => {
                const ids = [...design.coverVersionIds];
                if (e.target.value) ids[index] = e.target.value;
                else ids.splice(index, 1);
                updateDesign({ coverVersionIds: ids.filter(Boolean) });
              }}
            >
              <option value="">{index === 0 ? "No cover" : "None"}</option>
              {coverOptions
                .filter(
                  (v) =>
                    !design.coverVersionIds.includes(v.id) ||
                    design.coverVersionIds[index] === v.id,
                )
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.filename} · v{v.number}
                  </option>
                ))}
            </select>
          </label>
        ))}
        <p className="delivery-meta">
          Covers use these exact versions. Unpublished photos stay private; a replacement is never
          substituted automatically.
        </p>
      </fieldset>
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
