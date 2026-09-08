import type { Shot } from "@/lib/imaging";
import type { StudioFilter } from "./session";

type SaveView = {
  shots: readonly Shot[];
  selectedId: string | null;
  filter: StudioFilter;
};

/**
 * Tracks immutable Studio view snapshots, not a second store or a write permission.
 * Call the returned acknowledgment only after the real save has fulfilled.
 * The route's synchronous refs expose edits before React effects/the debounce run.
 */
export class StudioSaveBoundary {
  private sequence = 0;
  private committedSequence = 0;
  private committed: SaveView | null = null;

  begin(view: SaveView): () => void {
    const sequence = ++this.sequence;
    const snapshot = { ...view };
    return () => {
      // A delayed auxiliary receipt must not rewind a newer completed save.
      if (sequence <= this.committedSequence) return;
      this.committedSequence = sequence;
      this.committed = snapshot;
    };
  }

  pending(view: SaveView): boolean {
    // Empty-shoot replacement already uses the explicit, awaited clear path.
    if (!view.shots.length) return false;
    const saved = this.committed;
    return (
      !saved ||
      saved.shots !== view.shots ||
      saved.selectedId !== view.selectedId ||
      saved.filter !== view.filter
    );
  }
}
