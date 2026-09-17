export type PreviewRequest = {
  id: number;
  file: File;
  /** Folder names from the private file system's root. */
  folder: string[];
  name: string;
  maxEdge: number;
  quality: number;
};

export type PreviewReply =
  | { id: number; kind: "written"; bytes: number; width: number; height: number }
  /** The photo cannot become a preview here (an unsupported format, a corrupt file). */
  | { id: number; kind: "failed"; error: string }
  /** The browser refused the write for lack of space. */
  | { id: number; kind: "quota" }
  /** Something about this device, not this photo, stopped the write (no OPFS, a locked file). */
  | { id: number; kind: "unavailable"; error: string };
