import { useEffect, useRef, useState } from "react";
import {
  acknowledgeCommentDraft,
  moveCommentDraft,
  readCommentDrafts,
  reconcileCommentDrafts,
  saveCommentDrafts,
  updateCommentDraft,
  type CommentDraft,
  type CommentDrafts,
} from "@/lib/delivery/comment-drafts";
import type { Actor, DeliveryComment } from "@/lib/delivery/workflow";

// The gallery is keyed by scope. Only authenticated invitation views supply a storage scope.
export function useCommentDrafts(
  scope: string | undefined,
  comments: DeliveryComment[],
  actor: Actor,
) {
  const [initial] = useState(() => {
    try {
      return {
        drafts:
          scope && typeof window !== "undefined"
            ? readCommentDrafts(window.sessionStorage, scope)
            : {},
        error: "",
      };
    } catch {
      return {
        drafts: {},
        error: "Saved notes could not be restored. Keep this tab open while composing.",
      };
    }
  });
  const [drafts, setDrafts] = useState<CommentDrafts>(initial.drafts);
  const [storageError, setStorageError] = useState(initial.error);
  const current = useRef(drafts);

  function commit(next: CommentDrafts) {
    if (next === current.current) return;
    current.current = next;
    setDrafts(next);
    if (!scope) return;
    try {
      // Write during the interaction, not a deferred effect: mobile tabs may suspend immediately.
      saveCommentDrafts(window.sessionStorage, scope, next);
      setStorageError("");
    } catch {
      setStorageError(
        "This tab cannot save recovery notes. Your text is still here; keep the tab open until it is sent.",
      );
    }
  }
  useEffect(() => {
    commit(reconcileCommentDrafts(current.current, comments, actor));
    // commit uses only the gallery-scoped ref and stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, actor]);
  const dirty = Object.values(drafts).some((draft) => draft.body.trim());
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return {
    drafts,
    dirty,
    storageError,
    update: (
      versionId: string,
      photoId: string,
      patch: Partial<Pick<CommentDraft, "body" | "revision">>,
    ) => commit(updateCommentDraft(current.current, versionId, photoId, patch)),
    move: (from: string, to: string, photoId: string) =>
      commit(moveCommentDraft(current.current, from, to, photoId)),
    acknowledge: (versionId: string, operationId: string) =>
      commit(acknowledgeCommentDraft(current.current, versionId, operationId)),
  };
}
