/** RAM-only retry state. A storage PUT is not a confirmed client upload. */
export type ReferenceUpload = {
  file: File;
  transferredPath?: string;
  confirmationUnknown?: boolean;
};
type UploadDependencies = {
  createUrl: (file: File) => Promise<unknown>;
  put: (url: string, file: File) => Promise<Pick<Response, "ok" | "status">>;
  record: (path: string, file: File) => Promise<unknown>;
  /** Exact path lookup in the server-authorized client/shoot listing. Never filename matching. */
  isRecorded: (path: string) => Promise<boolean>;
  onProgress?: (file: File) => void;
  /** A route/account generation owns this batch; stale work must not admit another stage. */
  isCurrent?: () => boolean;
};
const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const hasError = (value: Record<string, unknown>) =>
  value["error"] !== undefined && value["error"] !== null;
const errorMessage = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

/**
 * Stop at the first failed acknowledgement; retain that file and every later file.
 * Successful files leave the queue once. Unknown record outcomes may only be checked,
 * not resent: a timed-out server request could still commit after a retry lookup.
 */
export async function uploadReferenceBatch(
  entries: readonly ReferenceUpload[],
  dependencies: UploadDependencies,
): Promise<{ completed: number; pending: ReferenceUpload[]; error: string | null }> {
  const pending = entries.map((entry) => ({ ...entry }));
  const assertCurrent = () => {
    if (dependencies.isCurrent?.() === false)
      throw new Error("Upload stopped because its destination changed.");
  };
  let completed = 0;
  while (pending.length) {
    const entry = pending[0]!;
    try {
      assertCurrent();
      dependencies.onProgress?.(entry.file);
      if (entry.confirmationUnknown) {
        const confirmed =
          !!entry.transferredPath && (await dependencies.isRecorded(entry.transferredPath));
        assertCurrent();
        if (!confirmed)
          throw new Error(
            "Upload confirmation is still unavailable. Check again; this file has not been sent twice.",
          );
      } else {
        if (!entry.transferredPath) {
          const slot = recordValue(await dependencies.createUrl(entry.file));
          assertCurrent();
          if (
            !slot ||
            hasError(slot) ||
            typeof slot["signedUrl"] !== "string" ||
            !slot["signedUrl"].trim() ||
            typeof slot["path"] !== "string" ||
            !slot["path"].trim()
          )
            throw new Error(
              errorMessage(slot?.["error"], "Could not start this upload. Retry it."),
            );
          const put = await dependencies.put(slot["signedUrl"], entry.file);
          assertCurrent();
          if (!put.ok) throw new Error(`File transfer failed (${put.status}). Retry this upload.`);
          entry.transferredPath = slot["path"];
        }
        let recorded: Record<string, unknown> | null;
        try {
          recorded = recordValue(await dependencies.record(entry.transferredPath, entry.file));
        } catch {
          entry.confirmationUnknown = true;
          throw new Error(
            "Upload confirmation was interrupted. Check its status before sending it again.",
          );
        }
        assertCurrent();
        if (recorded && hasError(recorded))
          throw new Error(
            errorMessage(recorded["error"], "The upload could not be recorded. Retry it."),
          );
        if (recorded?.["ok"] !== true) {
          entry.confirmationUnknown = true;
          throw new Error(
            "The server did not confirm this upload. Check its status before sending it again.",
          );
        }
      }
      pending.shift();
      completed++;
    } catch (error) {
      return {
        completed,
        pending,
        error: `${entry.file.name}: ${error instanceof Error ? error.message : "Upload failed. Retry it."}`,
      };
    }
  }
  return { completed, pending, error: null };
}
