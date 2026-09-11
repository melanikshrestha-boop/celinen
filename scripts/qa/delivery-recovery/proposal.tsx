import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CullChat } from "../../../src/components/studio/CullChat";
import { DEFAULT_EDITS, type Shot } from "../../../src/lib/imaging";
import {
  applyProposal,
  proposeCull,
  proposeEdits,
  type StudioProposal,
} from "../../../src/lib/studio/proposals";
import "../../../src/styles.css";
import "../../../src/components/workbench/workbench.css";

// Metadata-only component integration. No account provider, image decoding, RPC or shoot storage.
const frame = (id: string, verdict: Shot["verdict"]): Shot => ({
  id,
  name: `${id}.jpg`,
  file: new File(["original"], `${id}.jpg`),
  isRaw: false,
  previewUrl: null,
  sourceAvailable: true,
  width: 100,
  height: 100,
  sizeMb: 1,
  sharpness: 100,
  brightness: 128,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 80,
  flags: [],
  verdict,
  edits: { ...DEFAULT_EDITS },
});
const initial = () => [frame("candidate", "undecided"), frame("protected", "keep")];
const cull = (shots: Shot[]) =>
  proposeCull(shots, (shot) => (shot.verdict === "undecided" ? "keep" : shot.verdict), {
    title: "First-pass suggestions",
    description: "Review the proposed keeper before accepting.",
  });
const edit = (shots: Shot[]) =>
  proposeEdits(shots, "candidate", "selected", (shot) => ({ ...shot.edits, exposure: 8 }), {
    title: "Slightly brighter",
    description: "A small exposure adjustment for the open photo.",
  });

export function App() {
  const [shots, setShots] = useState(initial),
    [proposal, setProposal] = useState<StudioProposal | null>(() => cull(shots)),
    [before, setBefore] = useState(false),
    [applied, setApplied] = useState(0),
    [generation, setGeneration] = useState(0);
  Object.assign(window, {
    __proposalQA: {
      state: () => ({
        applied,
        pending: Boolean(proposal),
        shots: shots.map((shot) => ({
          id: shot.id,
          verdict: shot.verdict,
          exposure: shot.edits.exposure,
        })),
      }),
      mutateUnchanged: () =>
        setShots((current) =>
          current.map((shot) => (shot.id === "protected" ? { ...shot, verdict: "reject" } : shot)),
        ),
      replaceSource: () =>
        setShots((current) =>
          current.map((shot) =>
            shot.id === "candidate"
              ? {
                  ...shot,
                  file: new File(["replaced"], shot.file.name, {
                    lastModified: shot.file.lastModified,
                  }),
                }
              : shot,
          ),
        ),
      refreshThumbnails: () =>
        setShots((current) =>
          current.map((shot) => ({ ...shot, previewUrl: `blob:refreshed-${shot.id}` })).reverse(),
        ),
      preview: (kind: string) => setProposal(kind === "edit" ? edit(shots) : cull(shots)),
      reset: (kind: string) => {
        const next = initial();
        setShots(next);
        setProposal(kind === "edit" ? edit(next) : cull(next));
        setApplied(0);
        setGeneration((n) => n + 1);
      },
    },
  });
  return (
    <main
      className="photo-workbench"
      style={{ display: "block", padding: 16, height: "100dvh", overflow: "hidden" }}
    >
      <p style={{ fontSize: 11, color: "#999", marginBottom: 12 }}>
        LOCAL QA · Synthetic proposal · no cloud or photos
      </p>
      <section style={{ maxWidth: 390, height: "calc(100% - 28px)", margin: "0 auto" }}>
        <CullChat
          key={generation}
          workspace
          frameCount={shots.length}
          context="Synthetic metadata only"
          execute={async () => {
            throw new Error("No chat transport in this fixture.");
          }}
          proposal={proposal}
          before={before}
          onCompare={() => setBefore(!before)}
          onApply={() => {
            if (!proposal) throw new Error("No preview waiting.");
            const next = applyProposal(shots, proposal);
            setShots(next);
            setProposal(null);
            setApplied(applied + 1);
            return "Accepted synthetic preview. Originals are untouched.";
          }}
          onDiscard={() => {
            setProposal(null);
            return "Preview discarded. Your photos and picks are unchanged.";
          }}
          onTarget={() => {
            throw new Error("Scope changes are outside this fixture.");
          }}
        />
      </section>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
