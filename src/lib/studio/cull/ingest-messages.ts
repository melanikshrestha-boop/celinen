import type { CullReading } from "./engine";
import type { FaceReading, FocusHit, IngestOptions, NormalizedRect } from "./ingest-engine";

export type IngestRequest = {
  id: string;
  file: File;
  options?: IngestOptions | undefined;
};

export type IngestReply =
  | {
      id: string;
      kind: "read";
      reading: CullReading;
      width: number;
      height: number;
      captureTimeMs: number | null;
      captureTimeBasis?: "utc" | "camera_clock" | undefined;
      cameraKey?: string | undefined;
      thumbnail: Blob;
      /** Set when the photo decoded but is not whole (a cut-off file, corrupt
       * data): why, in plain words. The frame is shown, its readings are not
       * over a whole picture. */
      damaged?: string | undefined;
      /** The camera's AF area, normalized to the upright frame; absent when the file has none. */
      afPoint?: NormalizedRect | undefined;
      /** Whether the camera reported focus lock in that area; undefined when it did not say. */
      afConfirmed?: boolean | undefined;
      /** Sharpness at the AF area against the frame's sharpest detail. */
      focusHit?: FocusHit | undefined;
      /** The faces the engine found, most prominent first. Absent when this
       * lane has no face models, or the frame was too soft to be worth looking. */
      faces?: FaceReading[] | undefined;
      /** False when this lane could not load the face models at all. */
      eyesRead: boolean;
    }
  | { id: string; kind: "failed"; error: string };
