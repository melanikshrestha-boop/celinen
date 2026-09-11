import { useLayoutEffect, useRef, useState } from "react";
import { updateShootOrganization } from "@/lib/studio/shoot-directory";

export type OrganizedShootRow = {
  key: string;
  title: string;
  pinned?: boolean;
  archived?: boolean;
};
export function useShootRowActions(scope: string | null) {
  const owner = useRef(scope);
  owner.current = scope;
  const alive = useRef(true),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [archived, setArchived] = useState<OrganizedShootRow | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    setArchived(null);
    setError("");
    setBusy(false);
    return () => {
      alive.current = false;
    };
  }, [scope]);
  const run = async (row: OrganizedShootRow, field: "pinned" | "archived", value: boolean) => {
    if (!scope || locked.current) return;
    const requestOwner = scope;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await updateShootOrganization(
        scope,
        row.key,
        { [field]: value },
        { [field]: Boolean(row[field]) },
      );
      if (alive.current && owner.current === requestOwner && field === "archived")
        setArchived(value ? row : null);
    } catch (cause) {
      if (alive.current && owner.current === requestOwner)
        setError(
          cause instanceof Error
            ? cause.message
            : "This row could not be saved. Your photos are unchanged.",
        );
    } finally {
      locked.current = false;
      if (alive.current && owner.current === requestOwner) setBusy(false);
    }
  };
  return {
    busy,
    error,
    archived,
    pin: (row: OrganizedShootRow) => run(row, "pinned", !row.pinned),
    archive: (row: OrganizedShootRow) => run(row, "archived", !row.archived),
    undo: () =>
      archived ? run({ ...archived, archived: true }, "archived", false) : Promise.resolve(),
  };
}
