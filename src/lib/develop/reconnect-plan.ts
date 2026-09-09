import { fingerprintSource, supportedPhoto } from "../studio/ingest";
import { DEVELOP_ENGINE_LIMITS } from "./contract";
import type { DevelopPhoto } from "./store";

export const DEVELOP_RECONNECT_LIMITS = Object.freeze({
  maxFiles: 10000,
  maxTargets: 10000,
  maxCandidateLinks: 100000,
  maxFileBytes: DEVELOP_ENGINE_LIMITS.maxFileBytes,
});
export type DevelopReconnectStatus =
  "verified" | "unverified" | "ambiguous" | "unmatched" | "mismatch";
export type ReconnectCandidate = {
  file: File;
  /** Index in the original chooser/drop result; equal filenames are not deduplicated. */
  index: number;
  path: string;
  sha256: string;
};
export type DevelopReconnectEntry = {
  targetId: string;
  targetName: string;
  sourceFileName: string;
  /** Exact scan-time representation; never downgrade a verified match during execution. */
  expectedSourceDigest: string | null;
  status: DevelopReconnectStatus;
  file: File | null;
  candidates: ReconnectCandidate[];
  reason: string;
  selectedByDefault: boolean;
};
export type DevelopReconnectWarning = {
  fileIndex: number;
  fileName: string;
  path: string;
  reason: string;
};
export type DevelopReconnectPlan = {
  /** Required for execution. Pure previews may omit their scoped store binding. */
  namespace: string | null;
  entries: DevelopReconnectEntry[];
  skippedIds: string[];
  warnings: DevelopReconnectWarning[];
  cancelled: boolean;
  filesChecked: number;
  totalFiles: number;
};
export type DevelopReconnectOptions = {
  namespace?: string;
  signal?: AbortSignal;
  onProgress?: (progress: { index: number; total: number; fileName: string }) => void;
};
type Fingerprint =
  { kind: "sha256" | "legacy"; value: string } | { kind: "unknown" | "unsupported" };
function fingerprint(value: string | null): Fingerprint {
  if (value === null) return { kind: "unknown" };
  if (/^(?:sha256:)?[0-9a-f]{64}$/i.test(value))
    return { kind: "sha256", value: `sha256:${value.replace(/^sha256:/i, "").toLowerCase()}` };
  if (/^sha256-chain-v1:[0-9a-f]{64}$/.test(value)) return { kind: "legacy", value };
  return { kind: "unsupported" };
}
function abort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Reconnect scan cancelled", "AbortError");
}
function pathOf(file: File) {
  return file.webkitRelativePath || file.name;
}
async function fullSha256(file: File, signal: AbortSignal): Promise<string> {
  abort(signal);
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure photo fingerprinting is unavailable. Use localhost or HTTPS.");
  const bytes = await file.arrayBuffer();
  abort(signal);
  if (bytes.byteLength !== file.size) throw new Error("This file could not be read completely.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  abort(signal);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Read-only identity preflight, not a reconnect receipt or a decoder. Originals,
 * metadata and treatment documents are never modified. Every executed entry must
 * still re-read the current scoped photo and call reconnectDevelopPhoto after a
 * successful native decode. In particular, filename-only identity is NOT proof.
 */
export async function planDevelopReconnect(
  photos: readonly DevelopPhoto[],
  files: readonly File[],
  options: DevelopReconnectOptions = {},
): Promise<DevelopReconnectPlan> {
  if (files.length > DEVELOP_RECONNECT_LIMITS.maxFiles)
    throw new Error("Choose at most 10,000 files for one reconnect scan. Nothing was changed.");
  if (photos.length > DEVELOP_RECONNECT_LIMITS.maxTargets)
    throw new Error("Review at most 10,000 saved photos per reconnect scan. Nothing was changed.");
  const signal = options.signal ?? new AbortController().signal;
  const namespace = options.namespace ?? null;
  if (namespace !== null) {
    let parts: unknown;
    try {
      parts = JSON.parse(namespace);
    } catch {
      throw new Error("Invalid reconnect library scope.");
    }
    if (
      !Array.isArray(parts) ||
      parts.length !== 2 ||
      parts.some((part) => typeof part !== "string" || !part.trim() || part.length > 512) ||
      JSON.stringify(parts) !== namespace
    )
      throw new Error("Invalid reconnect library scope.");
  }
  // Snapshot only matching metadata. A later caller edit cannot change this plan mid-scan.
  const targets = photos.map((photo) => ({
    id: photo.id,
    name: photo.name,
    originalName: photo.sourceFileName || photo.name,
    identity: fingerprint(photo.sourceDigest),
    sourceDigest: photo.sourceDigest,
    available: Boolean(photo.sourceBlob?.size),
    invalidSource:
      (photo.sourceAvailable && !photo.sourceBlob?.size) ||
      (photo.sourceBlob !== null &&
        !(photo.sourceBlob instanceof Blob && photo.sourceBlob.size > 0)),
  }));
  const batch = [...files];
  const plan: DevelopReconnectPlan = {
    namespace,
    entries: [],
    skippedIds: [],
    warnings: [],
    cancelled: false,
    filesChecked: 0,
    totalFiles: batch.length,
  };
  const byId = new Map<string, typeof targets>();
  for (const target of targets) {
    const same = byId.get(target.id) ?? [];
    same.push(target);
    byId.set(target.id, same);
  }
  const entryTargets = new Map<DevelopReconnectEntry, (typeof targets)[number]>();
  const byName = new Map<string, DevelopReconnectEntry[]>();
  for (const group of byId.values()) {
    const target = group[0]!;
    if (group.length === 1 && target.available) {
      plan.skippedIds.push(target.id);
      continue;
    }
    const duplicate = group.length > 1;
    const entry: DevelopReconnectEntry = {
      targetId: target.id,
      targetName: target.name,
      sourceFileName: target.originalName,
      expectedSourceDigest: target.sourceDigest,
      status: duplicate ? "ambiguous" : target.invalidSource ? "mismatch" : "unmatched",
      file: null,
      candidates: [],
      selectedByDefault: false,
      reason: duplicate
        ? "This saved photo ID appears more than once. Reload the library; no target was chosen."
        : target.invalidSource
          ? "The saved original state is invalid. Reload Develop before reconnecting."
          : "No selected file has this exact original filename.",
    };
    plan.entries.push(entry);
    if (duplicate || target.invalidSource) continue;
    entryTargets.set(entry, target);
    const same = byName.get(target.originalName) ?? [];
    same.push(entry);
    byName.set(target.originalName, same);
  }
  let links = 0;
  for (const file of batch) links += byName.get(file.name)?.length ?? 0;
  if (links > DEVELOP_RECONNECT_LIMITS.maxCandidateLinks)
    throw new Error(
      "Too many same-name matches. Choose a smaller folder so each original can be reviewed safely. Nothing was changed.",
    );
  const validFiles = new Map<string, { candidate: ReconnectCandidate; legacy: string | null }[]>();
  const nameCounts = new Map<string, number>();
  for (const file of batch) nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1);
  for (const [index, file] of batch.entries()) {
    if (signal.aborted) break;
    try {
      options.onProgress?.({ index: index + 1, total: batch.length, fileName: file.name });
    } catch {
      /* Progress observers cannot alter identity matching. */
    }
    if (signal.aborted) break;
    const namedTargets = byName.get(file.name);
    try {
      if (!supportedPhoto(file)) throw new Error("This file type is not a supported photo.");
      if (!Number.isSafeInteger(file.size) || file.size <= 0)
        throw new Error("This file is empty or has an invalid size.");
      if (file.size > DEVELOP_RECONNECT_LIMITS.maxFileBytes)
        throw new Error("This file exceeds the 128 MiB Develop limit.");
      if (!namedTargets) {
        plan.filesChecked++;
        continue;
      }
      const sha256 = await fullSha256(file, signal);
      const needsLegacy = namedTargets.some(
        (entry) => entryTargets.get(entry)!.identity.kind === "legacy",
      );
      const legacy = needsLegacy ? await fingerprintSource(file, signal) : null;
      abort(signal);
      const same = validFiles.get(file.name) ?? [];
      same.push({ candidate: { file, index, path: pathOf(file), sha256 }, legacy });
      validFiles.set(file.name, same);
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        plan.cancelled = true;
        break;
      }
      plan.warnings.push({
        fileIndex: index,
        fileName: file.name,
        path: pathOf(file),
        reason: error instanceof Error ? error.message : "This file could not be read.",
      });
    }
    plan.filesChecked++;
  }
  plan.cancelled ||= signal.aborted;
  if (plan.cancelled) {
    // A partly scanned folder cannot prove a candidate is unique. Offer no partial plan.
    for (const entry of plan.entries) {
      entry.status = "unmatched";
      entry.file = null;
      entry.candidates = [];
      entry.selectedByDefault = false;
      entry.reason = "Scan cancelled. Scan again before choosing any originals.";
    }
    return plan;
  }
  for (const [entry, target] of entryTargets) {
    const named = validFiles.get(target.originalName) ?? [];
    const totalNamed = nameCounts.get(target.originalName) ?? 0;
    if (target.identity.kind === "unsupported") {
      entry.status = "mismatch";
      entry.reason =
        "The saved fingerprint format cannot be verified. Import separately to review the file; the saved photo remains unchanged. No filename-only fallback is allowed.";
      continue;
    }
    const identity = target.identity;
    entry.candidates = named
      .filter(({ candidate, legacy }) => {
        if (identity.kind === "unknown") return true;
        if (identity.kind === "legacy") return legacy === identity.value;
        if (identity.kind === "sha256") return candidate.sha256 === identity.value;
        return false;
      })
      .map(({ candidate }) => candidate);
    if (entry.candidates.length > 1 || (identity.kind === "unknown" && totalNamed > 1)) {
      entry.status = "ambiguous";
      entry.reason =
        "Multiple selected files share this original identity or filename. Reconnect this photo individually.";
    } else if (entry.candidates.length === 1) {
      entry.file = entry.candidates[0]!.file;
      entry.status = identity.kind === "unknown" ? "unverified" : "verified";
      entry.selectedByDefault = entry.status === "verified";
      entry.reason =
        identity.kind === "unknown"
          ? "Filename only: this older photo has no saved fingerprint. Select it explicitly only if you know this is the original. Image decode is still required."
          : "Exact original filename and saved full-byte fingerprint match. Image decode and current-record validation are still required.";
    } else if (totalNamed) {
      entry.status = "mismatch";
      entry.reason = named.length
        ? "Same-name files have different bytes from the saved fingerprint."
        : "Same-name files could not be used. Review the file warnings.";
    }
  }
  // Never silently assign the same selected file to multiple saved records.
  const claimed = new Map<number, DevelopReconnectEntry[]>();
  for (const entry of plan.entries)
    for (const candidate of entry.candidates) {
      const owners = claimed.get(candidate.index) ?? [];
      owners.push(entry);
      claimed.set(candidate.index, owners);
    }
  for (const owners of claimed.values())
    if (owners.length > 1)
      for (const entry of owners) {
        entry.status = "ambiguous";
        entry.file = null;
        entry.selectedByDefault = false;
        entry.reason =
          "This selected file could belong to multiple saved photos. Reconnect them individually; no target was chosen.";
      }
  return plan;
}
