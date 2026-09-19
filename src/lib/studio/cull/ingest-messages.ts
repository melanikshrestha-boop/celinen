import type { CullReading } from "./engine";
import type {
  CullCameraFacts,
  FaceReading,
  FocusHit,
  IngestOptions,
  NormalizedRect,
} from "./ingest-engine";
import type { CullSubjectFocus, CullValidity } from "./intel";

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
      /** Whether the frame is a photograph at all, judged before any score.
       * Absent only for replies from an older worker build. */
      validity?: CullValidity | undefined;
      /** False when the gate rejected the frame and no score was measured. */
      measured?: boolean | undefined;
      /** Which rung of the evidence ladder focus was judged on. */
      subject?: CullSubjectFocus | undefined;
      /** 32x24 luma, for burst motion and roles. */
      signature?: Uint8Array | undefined;
      /** The camera's own words, for the shoot membership pass. */
      facts?: CullCameraFacts | undefined;
    }
  | { id: string; kind: "failed"; error: string };
