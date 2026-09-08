import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DeliveryGallery } from "../../../src/components/delivery/DeliveryGallery";
import { commentDraftScope } from "../../../src/lib/delivery/comment-drafts";
import { invitationGeneration } from "../../../src/lib/delivery/experience";
import {
  clientState,
  newDelivery,
  transition,
  type DeliveryCommand,
  type DeliveryState,
  type VersionInput,
} from "../../../src/lib/delivery/workflow";
import fixture from "../../../tests/fixtures/delivery/delivery-proof-usaf-pd.jpg?url";
import "../../../src/styles.css";

// No remote functions, identity, credentials, cloud, or user photographs in this test surface.
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const galleryId = id(1),
  key = "lenslabs.synthetic-delivery-recovery.room.v1";
const at = () => new Date().toISOString();
const metadata = {
  bytes: 385875,
  sha256: "6902c502ba620578dbc22a959c3a75f63adb5bfa182cd31fce6c0dda199cc372",
  width: 1200,
  height: 755,
};
function version(n: number, photoId: string): VersionInput {
  return {
    id: id(n),
    photoId,
    filename: `synthetic-${photoId === id(2) ? "one" : "two"}.jpg`,
    source: null,
    variants: { proof: metadata, phone: metadata, full: metadata },
  };
}
function apply(
  state: DeliveryState,
  command: DeliveryCommand | { type: "complete"; versionId: string },
  actor: "client" | "owner" = "owner",
  operation = crypto.randomUUID(),
) {
  return transition(state, command, actor, operation, JSON.stringify(command), at());
}
function initial() {
  const saved = sessionStorage.getItem(key);
  if (saved) return JSON.parse(saved) as DeliveryState;
  let state = newDelivery(
    {
      id: galleryId,
      title: "Synthetic delivery recovery",
      clientName: "QA Client",
      message: "",
      selectionLimit: 2,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    at(),
  );
  for (const v of [version(4, id(2)), version(5, id(3))]) {
    state = apply(state, { type: "reserve", version: v });
    state = apply(state, { type: "complete", versionId: v.id });
  }
  state = apply(state, { type: "publish", versionIds: [id(4), id(5)] });
  for (const photoId of [id(2), id(3)])
    state = apply(state, { type: "pick", photoId, on: true }, "client");
  state = apply(state, { type: "submit", photoIds: [id(2), id(3)] }, "client");
  sessionStorage.setItem(key, JSON.stringify(state));
  return state;
}
let authoritative = initial(),
  publishView: (state: DeliveryState) => void;
let loseResponse = false,
  offline = false,
  delay = false,
  finish: (() => void) | undefined;
Object.assign(window, {
  __deliveryQA: {
    state: () => structuredClone(authoritative),
    loseNextResponse: () => {
      loseResponse = true;
    },
    offline: (value: boolean) => {
      offline = value;
    },
    delayNextResponse: () => {
      delay = true;
    },
    finishResponse: () => finish?.(),
    publishRevision: () => {
      const v = version(6 + authoritative.photos[0]!.versions.length, id(2));
      authoritative = apply(authoritative, { type: "reserve", version: v });
      authoritative = apply(authoritative, { type: "complete", versionId: v.id });
      authoritative = apply(authoritative, { type: "publish", versionIds: [v.id] });
      sessionStorage.setItem(key, JSON.stringify(authoritative));
      publishView(authoritative);
    },
    rotate: () => {
      authoritative = structuredClone(authoritative);
      authoritative.events.push({
        id: crypto.randomUUID(),
        at: at(),
        role: "owner",
        text: "Private invitation replaced; previous link revoked",
      });
      sessionStorage.setItem(key, JSON.stringify(authoritative));
      publishView(authoritative);
    },
    releaseFinals: () => {
      if (!authoritative.approvals.some((approval) => !approval.revokedAt)) {
        for (const versionId of [id(4), id(5)])
          authoritative = apply(authoritative, { type: "approve", versionId }, "client");
      }
      const unreleased = [id(4), id(5)].filter(
        (versionId) => !authoritative.released.includes(versionId),
      );
      if (unreleased.length)
        authoritative = apply(authoritative, { type: "release", versionIds: unreleased });
      sessionStorage.setItem(key, JSON.stringify(authoritative));
      publishView(authoritative);
    },
    seedSelectionNotes: () => {
      if (!authoritative.comments.some((comment) => comment.id === id(50)))
        authoritative = apply(
          authoritative,
          {
            type: "comment",
            versionId: id(4),
            body: 'Crop tighter, keep the sign — 東京 📷\nClient note, "quoted".',
            revision: true,
          },
          "client",
          id(50),
        );
      sessionStorage.setItem(key, JSON.stringify(authoritative));
      publishView(authoritative);
    },
    makeFilenameAmbiguous: () => {
      authoritative = structuredClone(authoritative);
      authoritative.photos[1]!.versions[0]!.filename = "SYNTHETIC-ONE.JPG";
      sessionStorage.setItem(key, JSON.stringify(authoritative));
      publishView(authoritative);
    },
  },
});

export function App() {
  const [state, setState] = useState(authoritative),
    [busy, setBusy] = useState(false);
  const ownerView = new URLSearchParams(location.search).get("actor") === "owner";
  publishView = setState;
  const scope = commentDraftScope(galleryId, invitationGeneration(state));
  return (
    <main className="delivery-client">
      <p role="note">
        LOCAL QA · Synthetic photos and simulated transport · not a published gallery
      </p>
      <DeliveryGallery
        key={scope}
        draftScope={scope}
        room={{
          id: galleryId,
          revision: state.events.length,
          state: ownerView ? state : clientState(state),
        }}
        actor={ownerView ? "owner" : "client"}
        busy={busy}
        localUrls={Object.fromEntries(
          state.photos.flatMap((p) => p.versions.map((v) => [v.id, fixture])),
        )}
        media={async (ids) => ids.map((versionId) => ({ versionId, url: fixture }))}
        refresh={async () => {
          setState(structuredClone(authoritative));
        }}
        run={async (command, operationId) => {
          setBusy(true);
          try {
            if (offline) throw new Error("Simulated offline: note was not sent.");
            authoritative = apply(
              authoritative,
              command,
              ownerView ? "owner" : "client",
              operationId,
            );
            sessionStorage.setItem(key, JSON.stringify(authoritative));
            if (loseResponse) {
              loseResponse = false;
              throw new Error("Simulated lost response: refresh before retrying.");
            }
            if (delay) {
              delay = false;
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
            }
            setState(structuredClone(authoritative));
          } finally {
            setBusy(false);
          }
        }}
      />
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
