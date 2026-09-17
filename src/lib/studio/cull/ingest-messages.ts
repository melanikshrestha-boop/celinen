import type { CullReading } from "./engine";
import type { IngestOptions } from "./ingest-engine";

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
    }
  | { id: string; kind: "failed"; error: string };
