import type { Shot } from "../imaging";
type Capsule = {
  signature: string;
  originals: Map<string, { identity: string; file: File }>;
  undo: unknown[];
};
const capsules = new Map<string, Capsule>();
const signature = (shots: Shot[]) =>
  JSON.stringify(shots.map(({ id, name, verdict, edits }) => [id, name, verdict, edits]));
const sourceIdentity = (shot: Shot) =>
  JSON.stringify([
    shot.id,
    shot.name,
    shot.relativePath,
    shot.sizeMb,
    shot.isRaw,
    shot.width,
    shot.height,
  ]);
/** A shoot switch preserves live file handles and Undo within this tab, never across accounts. */
export function rememberStudioRuntime(key: string, shots: Shot[], undo: unknown[]) {
  capsules.set(key, {
    signature: signature(shots),
    originals: new Map(
      shots
        .filter((shot) => shot.sourceAvailable !== false)
        .map((shot) => [shot.id, { identity: sourceIdentity(shot), file: shot.file }]),
    ),
    undo: structuredClone(undo),
  });
}
export function restoreStudioRuntime(key: string, shots: Shot[]) {
  const cached = capsules.get(key);
  if (!cached) return { shots, undo: [] };
  return {
    shots: shots.map((shot) => {
      const source = cached.originals.get(shot.id);
      const file = source?.identity === sourceIdentity(shot) ? source.file : null;
      return file ? { ...shot, file, sourceAvailable: true } : shot;
    }),
    undo: cached.signature === signature(shots) ? structuredClone(cached.undo) : [],
  };
}
