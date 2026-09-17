import type { CullReading } from "./engine";
import type { FocusHit, IngestOptions, NormalizedRect } from "./ingest-engine";

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
      /** The camera's AF area, normalized to the upright frame; absent when the file has none. */
      afPoint?: NormalizedRect | undefined;
      /** Whether the camera reported focus lock in that area; undefined when it did not say. */
      afConfirmed?: boolean | undefined;
      /** Sharpness at the AF area against the frame's sharpest detail. */
      focusHit?: FocusHit | undefined;
    }
  | { id: string; kind: "failed"; error: string };
