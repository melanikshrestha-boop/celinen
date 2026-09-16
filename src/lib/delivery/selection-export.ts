import type { DeliveryComment, DeliveryState, DeliveryVersion } from "./workflow";

export type SubmittedSelectionRow = {
  submissionAt: string;
  submissionId: string;
  photoId: string;
  versionId: string;
  filename: string;
  versionNumber: number;
  clientNotes: DeliveryComment[];
};

export type EditorLookupTarget = "lightroom" | "capture-one";

export type SubmittedEditorLookup = {
  target: EditorLookupTarget;
  filenames: string[];
  text: string;
};

function latestSubmission(state: DeliveryState) {
  const submission = state.submissions.at(-1);
  if (!submission) throw new Error("No submitted selection is available to export.");
  return submission;
}

/** Export the immutable latest submission, never the mutable current picks or a filename match. */
export function submittedSelectionRows(state: DeliveryState): SubmittedSelectionRow[] {
  const submission = latestSubmission(state);
  const seen = new Set<string>();
  const versionsByIdentity = new Map<string, DeliveryVersion>();
  for (const photo of state.photos)
    for (const version of photo.versions) {
      if (version.photoId !== photo.id) continue;
      const identity = `${photo.id}:${version.id}`;
      if (versionsByIdentity.has(identity))
        throw new Error("The gallery history contains a duplicate photo version.");
      versionsByIdentity.set(identity, version);
    }
  const notesByVersion = new Map<string, DeliveryComment[]>();
  for (const comment of state.comments) {
    if (comment.role !== "client") continue;
    const identity = `${comment.photoId}:${comment.versionId}`;
    const notes = notesByVersion.get(identity) ?? [];
    notes.push(comment);
    notesByVersion.set(identity, notes);
  }
  return submission.items.map((item) => {
    const identity = `${item.photoId}:${item.versionId}`;
    if (seen.has(identity))
      throw new Error("The submitted selection contains a duplicate version.");
    seen.add(identity);
    const version = versionsByIdentity.get(identity);
    if (!version)
      throw new Error(
        "A submitted photo version is missing. Restore the gallery history before exporting; no rows were omitted.",
      );
    return {
      submissionAt: submission.at,
      submissionId: submission.id,
      photoId: item.photoId,
      versionId: item.versionId,
      filename: version.filename,
      versionNumber: version.number,
      clientNotes: (notesByVersion.get(identity) ?? []).map((comment) => ({ ...comment })),
    };
  });
}

function csvCell(value: string): string {
  const protectedValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function changeStatus(notes: DeliveryComment[]): string {
  const requests = notes.filter((note) => note.revision);
  if (!requests.length) return "None";
  return requests.some((note) => !note.resolvedAt) ? "Open" : "Addressed";
}

export function submittedSelectionCsv(state: DeliveryState): string {
  const rows = submittedSelectionRows(state).map((row) => {
    const clientNotes = row.clientNotes.map((note) => note.body).join("\n\n");
    const noteTimes = row.clientNotes.map((note) => note.at).join("\n");
    const changeRequests = row.clientNotes
      .filter((note) => note.revision)
      .map((note) => note.body)
      .join("\n\n");
    return [
      row.submissionAt,
      row.submissionId,
      row.photoId,
      row.versionId,
      row.filename,
      String(row.versionNumber),
      clientNotes,
      noteTimes,
      changeStatus(row.clientNotes),
      changeRequests,
    ]
      .map(csvCell)
      .join(",");
  });
  return [
    "Submission (UTC)",
    "Submission ID",
    "Photo ID",
    "Version ID",
    "Filename",
    "Version",
    "Client notes",
    "Client note timestamps (UTC)",
    "Change request status",
    "Change requests",
  ]
    .map(csvCell)
    .join(",")
    .concat("\r\n", rows.join("\r\n"), rows.length ? "\r\n" : "");
}

function normalizedFilename(filename: string): string {
  return filename.normalize("NFC").toLocaleLowerCase("en-US");
}

/**
 * Build a pasteable editor lookup from the immutable latest submission.
 * Celinen IDs in the CSV remain authoritative; this convenience list fails closed whenever an
 * editor's filename-only lookup could select the wrong photo.
 */
export function submittedEditorLookup(
  state: DeliveryState,
  target: EditorLookupTarget,
): SubmittedEditorLookup {
  const filenames = submittedSelectionRows(state).map((row) => row.filename);
  const normalized = filenames.map(normalizedFilename);
  const duplicate = normalized.find((filename, index) => normalized.indexOf(filename) !== index);
  if (duplicate)
    throw new Error(
      "Editor lookup blocked: duplicate filenames cannot identify the submitted photos safely. Use the Celinen selection CSV instead.",
    );

  if (target === "lightroom") {
    if (filenames.some((filename) => filename.includes(",")))
      throw new Error(
        "Lightroom lookup blocked: a filename contains a comma. Use the Celinen selection CSV instead.",
      );
    const partialMatch = normalized.some((filename, index) =>
      normalized.some(
        (candidate, candidateIndex) => candidateIndex !== index && candidate.includes(filename),
      ),
    );
    if (partialMatch)
      throw new Error(
        "Lightroom lookup blocked: one filename partially matches another. Use the Celinen selection CSV instead.",
      );
    return { target, filenames: [...filenames], text: filenames.join(",") };
  }

  if (filenames.some((filename) => /\s/.test(filename)))
    throw new Error(
      "Capture One lookup blocked: a filename contains whitespace. Use the Celinen selection CSV instead.",
    );
  return { target, filenames: [...filenames], text: filenames.join(" ") };
}
