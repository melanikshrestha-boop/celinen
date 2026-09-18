import type { RawDecodeRequest as EngineRequest, RawSensorDescription } from "./raw-decode-engine";

export type RawDecodeRequest =
  | {
      id: number;
      kind: "decode";
      /** The whole RAW, transferred. The worker owns it from here. */
      file: ArrayBuffer;
      request: EngineRequest;
      /** Let the worker pick the demosaic once it knows how big the picture
       * is. Only the editing render asks for this; an export is always full. */
      adaptive?: boolean;
    }
  | { id: number; kind: "cancel" };

export type RawDecodeReply =
  /** The container parsed and the output is sized; the decode is now running. */
  | { id: number; kind: "opened"; description: RawSensorDescription; width: number; height: number }
  | { id: number; kind: "progress"; progress: number }
  | {
      id: number;
      kind: "decoded";
      width: number;
      height: number;
      rgba: Uint8ClampedArray<ArrayBuffer>;
      kelvin: number;
      tint: number;
      whiteBalanceFromFile: boolean;
      description: RawSensorDescription;
      /** What the engine was holding at the end, for a memory report. */
      residentBytes: number;
    }
  /** This camera or packing is not one the converter reads. The caller keeps
   * whatever embedded JPEG it is already showing; this is not an error. */
  | { id: number; kind: "unsupported"; reason: string }
  | { id: number; kind: "cancelled" }
  | { id: number; kind: "failed"; error: string };
