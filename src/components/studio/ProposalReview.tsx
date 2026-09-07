import type { EditTarget, StudioProposal } from "@/lib/studio/proposals";

export function ProposalReview({
  proposal,
  before,
  onCompare,
  onApply,
  onDiscard,
  onTarget,
}: {
  proposal: StudioProposal;
  before: boolean;
  onCompare: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onTarget: (target: EditTarget) => void;
}) {
  const keeps = proposal.frames.filter((frame) => frame.afterVerdict === "keep").length;
  const rejects = proposal.frames.filter((frame) => frame.afterVerdict === "reject").length;
  return (
    <section
      aria-label="Review proposed changes"
      className="my-3 rounded-lg border border-rust/40 bg-paper p-3 text-[12px] text-ink"
    >
      <p className="font-medium">{proposal.title} · preview only</p>
      <p className="mt-1 text-moss">{proposal.description}</p>
      {proposal.kind === "edit" ? (
        <label className="mt-3 flex items-center justify-between gap-2">
          <span>Apply to</span>
          <select
            aria-label="Edit scope"
            value={proposal.target}
            onChange={(event) => onTarget(event.target.value as EditTarget)}
            className="rounded-md border border-input bg-card px-2 py-1"
          >
            <option value="selected">Previewed photo</option>
            <option value="keepers">My keepers</option>
            <option value="all">Whole shoot</option>
          </select>
        </label>
      ) : (
        <p className="mt-2 text-moss">
          {keeps} suggested keepers · {rejects} suggested rejects · review the highlighted frame
          before accepting.
        </p>
      )}
      {proposal.kind === "edit" && proposal.target === "selected" && (
        <p className="mt-2 break-all font-mono text-[10px] text-moss">{proposal.frames[0]?.name}</p>
      )}
      <p className="mt-2 font-mono text-[10px] text-moss">
        {proposal.frames.length.toLocaleString()} photo{proposal.frames.length === 1 ? "" : "s"}{" "}
        affected · nothing saved yet
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {proposal.kind === "edit" && (
          <button
            onClick={onCompare}
            aria-pressed={before}
            className="rounded-md border border-input px-2.5 py-1.5"
          >
            {before ? "Show proposed edit" : "Compare before"}
          </button>
        )}
        <button onClick={onApply} className="rounded-md bg-ink px-3 py-1.5 text-paper2">
          {proposal.kind === "edit" ? "Apply edit" : "Accept suggestions"}
        </button>
        <button onClick={onDiscard} className="rounded-md px-2.5 py-1.5 text-moss hover:text-ink">
          Discard
        </button>
      </div>
      {proposal.limitations.map((note) => (
        <p key={note} className="mt-2 text-[10px] leading-relaxed text-moss">
          {note}
        </p>
      ))}
    </section>
  );
}
