/** A folder the photographer picked once and this browser remembers.
 *
 * Chromium hands out a directory handle that survives a reload; everywhere
 * else the hand-off falls back to a zip download, which needs no destination
 * at all. The handle's permission has to be granted again after a restart,
 * which takes a click, so that stays a button rather than something that
 * happens while the page loads.
 */
import { useCallback, useEffect, useState } from "react";
import {
  destinationSupport,
  ensurePermission,
  forgetDirectory,
  pickDestination,
  recallDirectory,
  type DestinationSupport,
} from "@/lib/studio/cull/handoff/fs-access";
import type { DirectoryHandleLike } from "@/lib/studio/cull/handoff/types";

export type CullDestination = {
  support: DestinationSupport;
  handle: DirectoryHandleLike | null;
  /** The folder's own name, for the button. */
  name: string;
  /** The remembered folder needs its permission granted again. */
  locked: boolean;
  problem: string | null;
  /** Opens the picker. Call from a click. */
  choose: () => Promise<void>;
  /** Asks for the remembered folder again. Call from a click. */
  unlock: () => Promise<void>;
  forget: () => void;
  /** True when a copy could start right now. */
  ready: boolean;
};

export function useDestination(key: string): CullDestination {
  const [support, setSupport] = useState<DestinationSupport>({ kind: "directory" });
  const [handle, setHandle] = useState<DirectoryHandleLike | null>(null);
  const [locked, setLocked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setSupport(destinationSupport());
    let live = true;
    recallDirectory(key).then(
      (stored) => {
        if (!live || !stored || stored.permission === "denied") return;
        setHandle(stored.handle);
        // "prompt": the folder is still remembered, one click from being usable.
        setLocked(stored.permission !== "granted");
      },
      // No remembered folder is the normal case, not a problem to report.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [key]);

  const choose = useCallback(async () => {
    setProblem(null);
    const result = await pickDestination({ id: key, remember: key });
    if (result.kind === "picked") {
      setHandle(result.handle);
      setLocked(false);
    } else if (result.kind === "error") setProblem(result.message);
    else if (result.kind === "unsupported") setSupport(result.support);
  }, [key]);

  const unlock = useCallback(async () => {
    if (!handle) return;
    const state = await ensurePermission(handle, { mode: "readwrite", request: true });
    if (state === "granted") setLocked(false);
    else setProblem("That folder is no longer available.");
  }, [handle]);

  const forget = useCallback(() => {
    setHandle(null);
    setLocked(false);
    void forgetDirectory(key).catch(() => {});
  }, [key]);

  return {
    support,
    handle,
    name: handle?.name ?? "",
    locked,
    problem,
    choose,
    unlock,
    forget,
    ready: support.kind === "zip" ? true : Boolean(handle) && !locked,
  };
}
