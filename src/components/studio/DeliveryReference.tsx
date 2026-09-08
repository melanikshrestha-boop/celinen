import type { Edits, Shot } from "@/lib/imaging";
import type { StudioHandoff } from "@/lib/delivery/studio-handoff";

export type DeliveryReferenceValue = { handoff: StudioHandoff; reviewedEdits: Edits };

/** Plain reference text only: never added to the chat transcript or tool context. */
export function DeliveryReference({
  value,
  error,
  source,
  selectedId,
  onSelect,
}: {
  value: DeliveryReferenceValue | null;
  error: string | null;
  source?: Shot | undefined;
  selectedId: string | null;
  onSelect: () => void;
}) {
  if (error)
    return (
      <p role="status" className="py-2 text-xs text-moss">
        {error}
      </p>
    );
  if (!value) return null;
  const { handoff, reviewedEdits } = value;
  const matchingEdit =
    source &&
    (Object.keys(reviewedEdits) as (keyof Edits)[]).every(
      (key) => source.edits[key] === reviewedEdits[key],
    );
  const openRequests = handoff.notes.filter(
    (note) => note.role === "client" && note.revision && !note.resolvedAt,
  ).length;
  return (
    <details
      open
      className="min-w-0 py-3 text-xs leading-relaxed"
      aria-label="Delivery feedback reference"
    >
      <summary className="cursor-pointer font-medium">
        Client feedback · version {handoff.versionNumber}
        {openRequests ? ` · ${openRequests} open request${openRequests === 1 ? "" : "s"}` : ""}
      </summary>
      <div className="mt-2 space-y-3">
        <p className="break-words font-medium">
          {handoff.filename}
          <span className="block font-normal text-moss">{handoff.galleryTitle}</span>
        </p>
        <p className="text-moss">
          {matchingEdit
            ? "Current adjustments match this delivered version."
            : "Studio keeps your current edit. These notes refer to an earlier or different adjustment version."}{" "}
          No changes are applied automatically.
        </p>
        {source && selectedId !== handoff.source.frameId && (
          <button
            type="button"
            className="text-left underline underline-offset-4"
            onClick={onSelect}
          >
            Show the feedback’s source photo
          </button>
        )}
        <div
          className="max-h-64 space-y-4 overflow-y-auto pr-1"
          tabIndex={0}
          aria-label="Version-linked notes"
        >
          {handoff.notes.length ? (
            handoff.notes.map((note) => (
              <div key={note.id}>
                <p className="text-moss">
                  {note.role === "client" ? "Client" : "Photographer"} ·{" "}
                  {note.revision
                    ? note.resolvedAt
                      ? "Resolved request"
                      : "Change requested"
                    : "Comment"}
                  <time className="block" dateTime={note.at}>
                    {new Date(note.at).toLocaleString()}
                  </time>
                </p>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {note.body}
                </p>
              </div>
            ))
          ) : (
            <p className="text-moss">No comments on this delivered version.</p>
          )}
        </div>
        <p className="text-[11px] text-moss">
          Snapshot from {new Date(handoff.capturedAt).toLocaleString()} · not live. Reopen from
          Delivery for new notes or status changes.
        </p>
      </div>
    </details>
  );
}
