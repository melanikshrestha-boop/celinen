import type { DevelopSettings } from "../contract";
import type { DevelopAutoSuggestion } from "./engine";

type SourceJob = {
  id: number;
  /** Names the decoded pixels: one Blob at one working edge. */
  sourceKey: string;
  edge: number;
  /** Present only when the worker does not already hold `sourceKey`. Transferred. */
  bitmap?: ImageBitmap;
};

export type DevelopWasmRequest =
  | { id: number; kind: "probe" }
  | (SourceJob & { kind: "render"; settings: DevelopSettings; quality: number })
  | (SourceJob & { kind: "suggest" })
  | { id: number; kind: "cancel" };

export type DevelopWasmReply =
  | { id: number; kind: "ready"; version: string }
  | { id: number; kind: "rendered"; blob: Blob }
  | { id: number; kind: "suggestion"; suggestion: DevelopAutoSuggestion }
  | { id: number; kind: "need-source" }
  | { id: number; kind: "cancelled" }
  | { id: number; kind: "failed"; error: string; fatal: boolean };
