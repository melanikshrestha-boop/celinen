import { ArrowUpRight, Check, ImageOff } from "lucide-react";
import { formatStorageBytes } from "@/lib/archive/keeper-manifest";
import type { ShootBrief } from "@/lib/studio/shoot-brief";

export function ShootOverview({
  shoot,
  compact,
  onReview,
  onOpen,
  onReconnect,
  paused,
}: {
  shoot: ShootBrief;
  compact: boolean;
  paused: boolean;
  onReview: () => void;
  onOpen: (id: string) => void;
  onReconnect?: (() => void) | undefined;
}) {
  return (
    <section
      className={`workbench-shoot ${compact ? "is-compact" : ""}`}
      aria-label="Current shoot"
    >
      <header>
        <div>
          {!compact && <p className="workbench-eyebrow">CURRENT SHOOT</p>}
          <h1>{shoot.title}</h1>
          <p className="workbench-shoot-counts">
            {shoot.total.toLocaleString()} {shoot.total === 1 ? "photo" : "photos"} <span>·</span>{" "}
            {shoot.keepers.toLocaleString()} {shoot.keepers === 1 ? "keeper" : "keepers"}
            {shoot.ingestBytes > 0 && (
              <>
                {" "}
                <span>·</span> {formatStorageBytes(shoot.ingestBytes)} in
                <span> · </span>
                {formatStorageBytes(shoot.keeperBytes)} keepers
              </>
            )}
            {shoot.undecided > 0 && (
              <>
                {" "}
                <span>·</span> {shoot.undecided.toLocaleString()} to review
              </>
            )}
          </p>
        </div>
        {compact && (
          <button type="button" onClick={onReview} className="workbench-text-action">
            Open shoot <ArrowUpRight size={15} />
          </button>
        )}
      </header>
      {!compact && (
        <>
          {shoot.previews.length ? (
            <div className="workbench-shoot-previews" data-count={shoot.previews.length}>
              {shoot.previews.map((shot) => (
                <button
                  type="button"
                  key={shot.id}
                  onClick={() => onOpen(shot.id)}
                  aria-label={`Open ${shot.name} in Studio`}
                >
                  <img src={shot.previewUrl!} alt={shot.name} decoding="async" />
                  <span className="workbench-preview-caption">{shot.name}</span>
                  {shot.verdict === "keep" && (
                    <span className="workbench-preview-keeper" aria-label="Keeper">
                      <Check size={13} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="workbench-previews-unavailable">
              <ImageOff size={25} />
              <p>Previews aren’t available. Your picks are still here.</p>
            </div>
          )}
          <div className="workbench-shoot-next">
            <button type="button" className="workbench-review-shoot" onClick={onReview}>
              {shoot.undecided ? "Continue reviewing" : "Open shoot"}
              <ArrowUpRight size={17} />
            </button>
            <span>Source previews · open Studio to see edits</span>
          </div>
          {shoot.missingOriginals > 0 && (
            <p className="workbench-source-note">
              {shoot.missingOriginals.toLocaleString()} original
              {shoot.missingOriginals === 1 ? " needs" : "s need"} reconnecting before
              full-resolution export.
              {!paused && onReconnect && (
                <button type="button" onClick={onReconnect}>
                  Choose source folder <ArrowUpRight size={13} />
                </button>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
