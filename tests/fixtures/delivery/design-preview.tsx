// Developer-only browser fixture. Never mounted by the app or shipped as a route.
// Uses public test images and a separate origin; refuses the customer's lab port.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GalleryPresentationForm } from "../../../src/components/delivery/GalleryPresentationForm";
import { SelectionRequestForm } from "../../../src/components/delivery/SelectionRequestForm";
import { DeliveryGallery } from "../../../src/components/delivery/DeliveryGallery";
import {
  ClientGalleryHeader,
  ClientGalleryFooter,
} from "../../../src/components/delivery/ClientGalleryIdentity";
import {
  galleryDesignAttributes,
  galleryPresentation,
} from "../../../src/lib/delivery/gallery-presentation";
import {
  listDrafts,
  saveDraft,
  saveDraftPresentation,
  saveDraftSelectionRequest,
  type Draft,
} from "../../../src/lib/delivery/outbox";
import {
  clientState,
  newDelivery,
  transition,
  selectionRequest,
  type DeliveryState,
} from "../../../src/lib/delivery/workflow";
import "../../../src/styles.css";

const galleryId = "a8000000-0000-4000-8000-000000000001";
const files = [
  "basketball-hangar-usnavy-pd.jpg",
  "basketball-action-usaf-pd.jpg",
  "volleyball-portrait-cc0.jpg",
];
const urls: Record<string, string> = {};
for (let i = 0; i < files.length; i++)
  urls[`a8000000-0000-4000-8000-00000000001${i}`] = `/tests/fixtures/photos/${files[i]}`;
function seed(): Draft {
  const at = new Date().toISOString();
  let state = newDelivery(
    {
      id: galleryId,
      title: "After the final whistle",
      clientName: "The team",
      message: "Choose your favorite moments.",
      selectionLimit: 3,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    },
    at,
  );
  const variant = { sha256: "a".repeat(64), bytes: 100, width: 1200, height: 800 };
  files.forEach((filename, i) => {
    const id = Object.keys(urls)[i]!;
    state = transition(
      state,
      {
        type: "reserve",
        version: {
          id,
          photoId: crypto.randomUUID(),
          filename,
          source: null,
          variants: { proof: variant, phone: variant, full: variant },
        },
      },
      "owner",
      crypto.randomUUID(),
      `reserve-${i}`,
      at,
    );
    state = transition(
      state,
      { type: "complete", versionId: id },
      "owner",
      crypto.randomUUID(),
      `complete-${i}`,
      at,
    );
  });
  state = transition(
    state,
    { type: "publish", versionIds: Object.keys(urls) },
    "owner",
    crypto.randomUUID(),
    "publish",
    at,
  );
  return { id: galleryId, createdAt: at, state, ownerId: null, synced: false };
}
export async function mount() {
  if (!import.meta.env.DEV || location.hostname !== "127.0.0.1" || location.port !== "8086")
    throw new Error("Use isolated 127.0.0.1:8086 only.");
  const existing = (await listDrafts(null)).find((d) => d.id === galleryId);
  const initial = existing ?? seed();
  if (!existing) await saveDraft(initial);
  const host = document.createElement("div");
  host.id = "delivery-design-qa";
  document.body.replaceChildren(host);
  function Fixture() {
    const [draft, setDraft] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [viewer, setViewer] = useState(false);
    const state: DeliveryState = clientState(draft.state);
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
        <p>Gallery design QA · public test images · local fixture, not a published gallery</p>
        <button onClick={() => setViewer(!viewer)}>
          {viewer ? "Edit presentation" : "View gallery"}
        </button>
        {!viewer && (
          <SelectionRequestForm
            state={draft.state}
            busy={busy}
            onDirty={() => {}}
            save={async (value) => {
              setBusy(true);
              try {
                setDraft(
                  await saveDraftSelectionRequest(
                    galleryId,
                    null,
                    selectionRequest(draft.state),
                    value,
                  ),
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {!viewer && (
          <GalleryPresentationForm
            state={draft.state}
            busy={busy}
            onDirty={() => {}}
            save={async (value) => {
              setBusy(true);
              try {
                setDraft(
                  await saveDraftPresentation(
                    galleryId,
                    null,
                    galleryPresentation(draft.state),
                    value,
                  ),
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        <main className="delivery-client-preview" {...galleryDesignAttributes(state)}>
          <ClientGalleryHeader state={state} />
          <DeliveryGallery
            room={{ id: galleryId, revision: 1, state }}
            actor="client"
            preview
            busy={false}
            localUrls={urls}
            media={async (ids) => ids.map((versionId) => ({ versionId, url: urls[versionId]! }))}
            run={async () => {
              throw new Error("Read-only fixture");
            }}
            refresh={async () => {}}
          />
          <ClientGalleryFooter state={state} preview />
        </main>
      </div>
    );
  }
  createRoot(host).render(<Fixture />);
}

/** Exercise the real IndexedDB transactions with only this fixture's metadata. */
export async function checkStorageBoundaries() {
  if (!import.meta.env.DEV || location.origin !== "http://127.0.0.1:8086")
    throw new Error("Isolated fixture only");
  const read = async () => (await listDrafts(null)).find((d) => d.id === galleryId)!;
  const draft = await read();
  if (!draft) throw new Error("Mount the fixture first");
  const rejected = async (call: () => Promise<unknown>, text: string) => {
    try {
      await call();
    } catch (error) {
      if (error instanceof Error && error.message.includes(text)) return true;
      throw error;
    }
    throw new Error(`Expected rejection: ${text}`);
  };
  const expected = selectionRequest(draft.state);
  const changed = { ...expected, selectionLimit: expected.selectionLimit === 2 ? 3 : 2 };
  await rejected(
    () => saveDraftSelectionRequest(galleryId, crypto.randomUUID(), expected, changed),
    "another account",
  );
  const updated = await saveDraftSelectionRequest(galleryId, null, expected, changed);
  await rejected(
    () => saveDraftSelectionRequest(galleryId, null, expected, expected),
    "another tab",
  );
  await saveDraft(draft); // stale upload refresh must not roll settings back
  if (JSON.stringify(selectionRequest((await read()).state)) !== JSON.stringify(changed))
    throw new Error("Stale refresh lost selection request");
  await saveDraftSelectionRequest(galleryId, null, selectionRequest(updated.state), expected);
  const oldPresentation = galleryPresentation(draft.state);
  const changedPresentation = { ...oldPresentation, studioName: "CAS test" };
  await rejected(
    () =>
      saveDraftPresentation(galleryId, crypto.randomUUID(), oldPresentation, changedPresentation),
    "another account",
  );
  await saveDraftPresentation(galleryId, null, oldPresentation, changedPresentation);
  await rejected(
    () => saveDraftPresentation(galleryId, null, oldPresentation, oldPresentation),
    "another tab",
  );
  await saveDraft(draft);
  if ((await read()).state.presentation?.studioName !== "CAS test")
    throw new Error("Stale refresh lost presentation");
  await saveDraftPresentation(galleryId, null, changedPresentation, oldPresentation);
  const final = await read();
  for (const key of [
    "photos",
    "picks",
    "submissions",
    "comments",
    "approvals",
    "released",
  ] as const)
    if (JSON.stringify(final.state[key]) !== JSON.stringify(draft.state[key]))
      throw new Error(`Settings changed ${key}`);
  return {
    wrongAccount: "rejected",
    staleTab: "rejected",
    staleUploadRefresh: "preserves both settings",
    photosAndFeedback: "unchanged",
  };
}
