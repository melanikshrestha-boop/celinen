/** Typed face of celinen-cull-intel.wasm (native/wasm/cull_intel_wasm.cpp): the
 * cull intelligence passes.
 *
 * Four questions the sharpness score cannot answer:
 *   1. is this a photograph at all (the validity gate),
 *   2. is it part of this shoot (membership),
 *   3. where should focus be judged (the subject hierarchy),
 *   4. which frame of this burst is the picture, and what are the others for
 *      (sequence roles).
 *
 * Numbers cross as flat arrays and text as one separated blob; the layouts
 * mirror native/wasm/cull_intel_wasm.cpp and the two must change together.
 */

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_intel_error: () => number;
  celinen_intel_validity_size: () => number;
  celinen_intel_subject_size: () => number;
  celinen_intel_head_count: () => number;
  celinen_intel_signature_size: () => number;
  celinen_intel_membership_in_size: () => number;
  celinen_intel_membership_out_size: () => number;
  celinen_intel_sequence_in_size: () => number;
  celinen_intel_sequence_out_size: () => number;
  celinen_intel_text: () => number;
  celinen_intel_source: (width: number, height: number) => number;
  celinen_intel_frame: (warnings: number, truncated: number) => number;
  celinen_intel_frame_signature: () => number;
  celinen_intel_membership_numbers: (count: number) => number;
  celinen_intel_text_in: (bytes: number) => number;
  celinen_intel_membership: (count: number, suspectAt: number, outsiderAt: number) => number;
  celinen_intel_sequence_numbers: (count: number) => number;
  celinen_intel_signatures: (count: number) => number;
  celinen_intel_sequence: (
    count: number,
    genre: number,
    duplicateEnergy: number,
    maxAlternates: number,
  ) => number;
  celinen_intel_release: () => void;
};

export type CullValidityState = "valid" | "suspect" | "invalid";
export type CullValidityKind =
  | "photo"
  | "noise"
  | "flat"
  | "black"
  | "white"
  | "test-pattern"
  | "corrupted"
  | "misfire"
  | "extreme-exposure"
  | "illustration"
  | "screenshot"
  | "document";

/** Everything the gate measured. Kept so thresholds can be audited on a real
 * shoot, and so a learned validity head can be trained on the same features. */
export type CullValidityEvidence = {
  lumaMean: number;
  lumaStd: number;
  lumaLow: number;
  lumaHigh: number;
  clippedLow: number;
  clippedHigh: number;
  spectralSlope: number;
  spectralFitError: number;
  spectralPeak: number;
  autocorrelation: number;
  grain: number;
  smoothShare: number;
  exactFlat: number;
  exactFlatSmooth: number;
  exactFlatExtreme: number;
  paletteTop: number;
  paletteCount: number;
  saturation: number;
  grayscale: number;
  edgeDensity: number;
  edgeAxis: number;
  edgeFlankFlat: number;
  frozenRows: number;
  bandRows: number;
  decoderWarnings: number;
  truncated: boolean;
};

export type CullValidity = {
  state: CullValidityState;
  kind: CullValidityKind;
  /** How sure the gate is that this is not a usable photograph, 0..1. */
  confidence: number;
  /** Plain English for the photographer; empty when the frame is valid. */
  reason: string;
  evidence: CullValidityEvidence;
};

export type CullSubjectLevel = "eyes" | "face" | "body" | "object" | "salient" | "frame" | "none";

export type CullSubjectFocus = {
  /** Which rung of the evidence ladder the focus was judged on. */
  level: CullSubjectLevel;
  region: { x: number; y: number; width: number; height: number; confidence: number };
  focus: number;
  focusConfidence: number;
  /** Negative when no eyes were given. */
  eyeFocus: number;
  /** Negative when the detector said nothing about the eyes. */
  eyesOpen: number;
  subjectSize: number;
  saliency: number;
  /** "Focus judged on the eyes" — never "no face found". */
  evidence: string;
};

export const CULL_HEADS = [
  "validity",
  "subjectConfidence",
  "subjectFocus",
  "eyeFocus",
  "eyesOpen",
  "exposure",
  "noise",
  "cameraShake",
  "subjectMotion",
  "composition",
  "aesthetic",
  "expression",
  "peakAction",
  "occlusion",
  "duplicateSimilarity",
  "burstPosition",
  "ballVisibility",
  "pose",
] as const;
export type CullHead = (typeof CULL_HEADS)[number];
/** One head's judgment. Absent means no evidence, which is not a bad score. */
export type CullHeadValue = { value: number; confidence: number };
export type CullHeadSet = Partial<Record<CullHead, CullHeadValue>>;

/** False for the heads where a lower value is better, and for the purely
 * informational burst position. Mirrors cull_head_higher_is_better() in the
 * engine; both sides must agree or a learned ranker would train backwards. */
export const CULL_HEAD_HIGHER_IS_BETTER: Record<CullHead, boolean> = {
  validity: true,
  subjectConfidence: true,
  subjectFocus: true,
  eyeFocus: true,
  eyesOpen: true,
  exposure: true,
  noise: false,
  cameraShake: false,
  subjectMotion: false,
  composition: true,
  aesthetic: true,
  expression: true,
  peakAction: true,
  occlusion: false,
  duplicateSimilarity: false,
  burstPosition: false,
  ballVisibility: true,
  pose: true,
};

export type CullGenre = "sports" | "wedding" | "portrait" | "event";
const GENRES: readonly CullGenre[] = ["sports", "wedding", "portrait", "event"];

export type CullMembershipState = "member" | "suspect" | "outsider";
/** Evidence bits, matching CullMembershipEvidence in the engine. */
export const CULL_MEMBERSHIP_EVIDENCE = {
  noCameraData: 1 << 0,
  differentCamera: 1 << 1,
  timeOutlier: 1 << 2,
  downloadSize: 1 << 3,
  namePattern: 1 << 4,
  look: 1 << 5,
  editingSoftware: 1 << 6,
} as const;

export type CullMembershipInput = {
  hasExif?: boolean;
  make?: string | undefined;
  model?: string | undefined;
  serial?: string | undefined;
  lens?: string | undefined;
  software?: string | undefined;
  /** The file name as imported, for the shoot's naming pattern. */
  fileName?: string | undefined;
  captureTimeMs?: number | null | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** 16 hex characters from the reading, and its 4x4 colour signature. */
  hash?: string | undefined;
  color?: Uint8Array | undefined;
  /** True when the validity gate rejected the frame: it never defines the shoot. */
  invalid?: boolean | undefined;
};

export type CullMembership = {
  state: CullMembershipState;
  /** How sure the pass is that the frame does not belong, 0..1. */
  confidence: number;
  /** Bitmask of CULL_MEMBERSHIP_EVIDENCE. */
  evidence: number;
  /** "No camera data · Downloaded image size"; empty for a member. */
  reason: string;
  /** Signed distance from the shoot's own time span, ms. */
  timeOffsetMs: number;
};

export type CullBurstRole =
  "none" | "pick" | "alternate" | "review" | "build-up" | "follow-through" | "duplicate";

export type CullSequenceInput = {
  /** The burst id from the shoot pass; null when the frame stands alone. */
  group?: number | null | undefined;
  captureTimeMs?: number | null | undefined;
  /** The 32x24 luma signature from ingest. */
  signature?: Uint8Array | undefined;
  subject?: CullSubjectFocus | undefined;
  heads?: CullHeadSet | undefined;
  validity?: CullValidityState | undefined;
  /** The photographer's own decision: 0 undecided, 1 keep, 2 reject. */
  verdict?: 0 | 1 | 2 | undefined;
};

export type CullSequenceRow = {
  role: CullBurstRole;
  /** One plain-English line ("Earlier moment, slightly softer"). */
  reason: string;
  /** 0 is the pick; -1 outside a burst. */
  rank: number;
  burstSize: number;
  /** Motion energy arriving at this frame, 0..1. */
  motion: number;
  atPeak: boolean;
  heads: CullHeadSet;
};

export type CullMembershipOptions = { suspectAt?: number; outsiderAt?: number };
export type CullSequenceOptions = {
  genre?: CullGenre;
  duplicateEnergy?: number;
  maxAlternates?: number;
};

export type CullIntelEngine = {
  /** Judges one decoded frame: validity, subject focus and its signature. */
  frame(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    decode?: { warnings?: number; truncated?: boolean },
  ): { validity: CullValidity; subject: CullSubjectFocus; signature: Uint8Array };
  /** Which frames are not part of this shoot, and why. */
  membership(
    frames: readonly CullMembershipInput[],
    options?: CullMembershipOptions,
  ): CullMembership[];
  /** Burst roles: pick, alternate, review, build-up, follow-through, duplicate. */
  sequence(frames: readonly CullSequenceInput[], options?: CullSequenceOptions): CullSequenceRow[];
  release(): void;
};

const VALIDITY_STATES: readonly CullValidityState[] = ["valid", "suspect", "invalid"];
const VALIDITY_KINDS: readonly CullValidityKind[] = [
  "photo",
  "noise",
  "flat",
  "black",
  "white",
  "test-pattern",
  "corrupted",
  "misfire",
  "extreme-exposure",
  "illustration",
  "screenshot",
  "document",
];
const SUBJECT_LEVELS: readonly CullSubjectLevel[] = [
  "eyes",
  "face",
  "body",
  "object",
  "salient",
  "frame",
  "none",
];
const ROLES: readonly CullBurstRole[] = [
  "none",
  "pick",
  "alternate",
  "review",
  "build-up",
  "follow-through",
  "duplicate",
];
const MEMBERSHIP_STATES: readonly CullMembershipState[] = ["member", "suspect", "outsider"];

export const CULL_VALIDITY_SIZE = 29;
export const CULL_SUBJECT_SIZE = 12;
export const CULL_SIGNATURE_SIZE = 32 * 24;
/** The field separator every packed text blob between the C++ and this page
 * uses. A control character, so it can never appear in a camera's own words. */
export const UNIT = "";
const RECORD = "";
const WASI_ENOSYS = 52;

/** Reads one packed validity record. Exported so the ingest engine, which runs
 * the same gate inside its own module, decodes it the same way. */
export function readValidity(v: Float64Array, at = 0): CullValidity {
  const state = VALIDITY_STATES[v[at]!] ?? "valid";
  return {
    state,
    kind: VALIDITY_KINDS[v[at + 1]!] ?? "photo",
    confidence: v[at + 2]!,
    reason: "",
    evidence: {
      lumaMean: v[at + 3]!,
      lumaStd: v[at + 4]!,
      lumaLow: v[at + 5]!,
      lumaHigh: v[at + 6]!,
      clippedLow: v[at + 7]!,
      clippedHigh: v[at + 8]!,
      spectralSlope: v[at + 9]!,
      spectralFitError: v[at + 10]!,
      spectralPeak: v[at + 11]!,
      autocorrelation: v[at + 12]!,
      grain: v[at + 13]!,
      smoothShare: v[at + 14]!,
      exactFlat: v[at + 15]!,
      exactFlatSmooth: v[at + 16]!,
      exactFlatExtreme: v[at + 17]!,
      paletteTop: v[at + 18]!,
      paletteCount: v[at + 19]!,
      saturation: v[at + 20]!,
      grayscale: v[at + 21]!,
      edgeDensity: v[at + 22]!,
      edgeAxis: v[at + 23]!,
      edgeFlankFlat: v[at + 24]!,
      frozenRows: v[at + 25]!,
      bandRows: v[at + 26]!,
      decoderWarnings: v[at + 27]!,
      truncated: v[at + 28] === 1,
    },
  };
}

/** Reads one packed subject-focus record. */
export function readSubject(v: Float64Array, at = 0): CullSubjectFocus {
  return {
    level: SUBJECT_LEVELS[v[at]!] ?? "none",
    region: {
      x: v[at + 1]!,
      y: v[at + 2]!,
      width: v[at + 3]!,
      height: v[at + 4]!,
      confidence: v[at + 5]!,
    },
    focus: v[at + 6]!,
    focusConfidence: v[at + 7]!,
    eyeFocus: v[at + 8]!,
    eyesOpen: v[at + 9]!,
    subjectSize: v[at + 10]!,
    saliency: v[at + 11]!,
    evidence: "",
  };
}

function readHeads(v: Float64Array, at: number): CullHeadSet {
  const heads: CullHeadSet = {};
  CULL_HEADS.forEach((name, index) => {
    const confidence = v[at + index * 2 + 1]!;
    if (confidence >= 0) heads[name] = { value: v[at + index * 2]!, confidence };
  });
  return heads;
}

function writeHeads(heads: CullHeadSet | undefined, out: Float64Array, at: number) {
  CULL_HEADS.forEach((name, index) => {
    const head = heads?.[name];
    out[at + index * 2] = head?.value ?? 0;
    // A negative confidence means "never measured", which the engine keeps
    // apart from a measurement of zero.
    out[at + index * 2 + 1] = head ? head.confidence : -1;
  });
}

/** Control characters are the record separators, so they can never appear in a
 * value the page passes through. */
function field(value: string | undefined) {
  return (value ?? "").replaceAll(UNIT, " ").replaceAll(RECORD, " ").replaceAll("\n", " ");
}

export async function instantiateCullIntelWasm(
  binary: BufferSource | WebAssembly.Module,
): Promise<CullIntelEngine> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(
        `Cull intelligence needs an unexpected import: ${entry.module}.${entry.name}`,
      );
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const wasm = (await WebAssembly.instantiate(module, imports)).exports as unknown as Exports;
  wasm._initialize?.();

  const validitySize = wasm.celinen_intel_validity_size();
  const subjectSize = wasm.celinen_intel_subject_size();
  const headCount = wasm.celinen_intel_head_count();
  const signatureSize = wasm.celinen_intel_signature_size();
  const membershipIn = wasm.celinen_intel_membership_in_size();
  const membershipOut = wasm.celinen_intel_membership_out_size();
  const sequenceIn = wasm.celinen_intel_sequence_in_size();
  const sequenceOut = wasm.celinen_intel_sequence_out_size();
  if (
    validitySize !== CULL_VALIDITY_SIZE ||
    subjectSize !== CULL_SUBJECT_SIZE ||
    headCount !== CULL_HEADS.length ||
    signatureSize !== CULL_SIGNATURE_SIZE ||
    membershipIn !== 8 + 48 ||
    membershipOut !== 4 ||
    sequenceIn !== 18 + headCount * 2 ||
    sequenceOut !== 5 + headCount * 2
  )
    throw new Error("The cull intelligence layout does not match this build.");

  const decoder = new TextDecoder();
  const text = (pointer: number) => {
    const bytes = new Uint8Array(wasm.memory.buffer, pointer);
    let end = 0;
    while (bytes[end]) end++;
    return decoder.decode(bytes.subarray(0, end));
  };
  const failure = () =>
    new Error(text(wasm.celinen_intel_error()) || "The cull could not judge this shoot.");

  return {
    frame(rgba, width, height, decode = {}) {
      if (rgba.length !== width * height * 4)
        throw new Error("The cull received an incomplete frame.");
      const pointer = wasm.celinen_intel_source(width, height);
      if (!pointer) throw failure();
      new Uint8ClampedArray(wasm.memory.buffer, pointer, rgba.length).set(rgba);
      const result = wasm.celinen_intel_frame(decode.warnings ?? 0, decode.truncated ? 1 : 0);
      if (!result) throw failure();
      const v = new Float64Array(wasm.memory.buffer, result, validitySize + subjectSize);
      const validity = readValidity(v, 0);
      const subject = readSubject(v, validitySize);
      const [reason = "", evidence = ""] = text(wasm.celinen_intel_text()).split(UNIT);
      validity.reason = reason;
      subject.evidence = evidence;
      // Copied out: the next call reuses this memory, and growth detaches it.
      const signature = new Uint8Array(
        new Uint8Array(wasm.memory.buffer, wasm.celinen_intel_frame_signature(), signatureSize),
      );
      return { validity, subject, signature };
    },

    membership(frames, options = {}) {
      if (!frames.length) return [];
      const records = frames
        .map((frame) =>
          [
            field(frame.make),
            field(frame.model),
            field(frame.serial),
            field(frame.lens),
            field(frame.software),
            field(frame.fileName),
          ].join(UNIT),
        )
        .join(RECORD);
      const encoded = new TextEncoder().encode(records);
      const textPointer = wasm.celinen_intel_text_in(encoded.length);
      if (!textPointer) throw failure();
      new Uint8Array(wasm.memory.buffer, textPointer, encoded.length).set(encoded);
      const pointer = wasm.celinen_intel_membership_numbers(frames.length);
      if (!pointer) throw failure();
      const view = new Float64Array(wasm.memory.buffer, pointer, frames.length * membershipIn);
      frames.forEach((frame, index) => {
        const at = index * membershipIn;
        view[at] = frame.hasExif ? 1 : 0;
        view[at + 1] = frame.captureTimeMs ?? -1;
        view[at + 2] = frame.width ?? 0;
        view[at + 3] = frame.height ?? 0;
        view[at + 4] = frame.color && frame.hash ? 1 : 0;
        view[at + 5] = frame.hash ? Number.parseInt(frame.hash.slice(0, 8), 16) || 0 : 0;
        view[at + 6] = frame.hash ? Number.parseInt(frame.hash.slice(8, 16), 16) || 0 : 0;
        view[at + 7] = frame.invalid ? 1 : 0;
        for (let i = 0; i < 48; i++) view[at + 8 + i] = frame.color?.[i] ?? 0;
      });
      const result = wasm.celinen_intel_membership(
        frames.length,
        options.suspectAt ?? 0.5,
        options.outsiderAt ?? 0.85,
      );
      if (!result) throw failure();
      const rows = new Float64Array(wasm.memory.buffer, result, frames.length * membershipOut);
      const reasons = text(wasm.celinen_intel_text()).split("\n");
      return frames.map((_, index) => {
        const at = index * membershipOut;
        return {
          state: MEMBERSHIP_STATES[rows[at]!] ?? "member",
          confidence: rows[at + 1]!,
          evidence: rows[at + 2]!,
          reason: reasons[index] ?? "",
          timeOffsetMs: rows[at + 3]!,
        };
      });
    },

    sequence(frames, options = {}) {
      if (!frames.length) return [];
      const signatures = wasm.celinen_intel_signatures(frames.length);
      if (!signatures) throw failure();
      const bytes = new Uint8Array(wasm.memory.buffer, signatures, frames.length * signatureSize);
      frames.forEach((frame, index) => {
        if (frame.signature?.length === signatureSize)
          bytes.set(frame.signature, index * signatureSize);
      });
      const pointer = wasm.celinen_intel_sequence_numbers(frames.length);
      if (!pointer) throw failure();
      const view = new Float64Array(wasm.memory.buffer, pointer, frames.length * sequenceIn);
      frames.forEach((frame, index) => {
        const at = index * sequenceIn;
        const subject = frame.subject;
        view[at] = frame.group ?? -1;
        view[at + 1] = frame.captureTimeMs ?? -1;
        view[at + 2] = frame.signature?.length === signatureSize ? 1 : 0;
        view[at + 3] = subject ? 1 : 0;
        view[at + 4] = subject
          ? SUBJECT_LEVELS.indexOf(subject.level)
          : SUBJECT_LEVELS.indexOf("none");
        view[at + 5] = subject?.region.x ?? 0;
        view[at + 6] = subject?.region.y ?? 0;
        view[at + 7] = subject?.region.width ?? 0;
        view[at + 8] = subject?.region.height ?? 0;
        view[at + 9] = subject?.region.confidence ?? 0;
        view[at + 10] = subject?.focus ?? 0;
        view[at + 11] = subject?.focusConfidence ?? 0;
        view[at + 12] = subject?.eyeFocus ?? -1;
        view[at + 13] = subject?.eyesOpen ?? -1;
        view[at + 14] = subject?.subjectSize ?? 0;
        view[at + 15] = subject?.saliency ?? 0;
        view[at + 16] = VALIDITY_STATES.indexOf(frame.validity ?? "valid");
        view[at + 17] = frame.verdict ?? 0;
        writeHeads(frame.heads, view, at + 18);
      });
      const genre = GENRES.indexOf(options.genre ?? "sports");
      if (genre < 0) throw new Error(`The cull has no ${options.genre} profile.`);
      const result = wasm.celinen_intel_sequence(
        frames.length,
        genre,
        options.duplicateEnergy ?? 0.06,
        options.maxAlternates ?? 2,
      );
      if (!result) throw failure();
      const rows = new Float64Array(wasm.memory.buffer, result, frames.length * sequenceOut);
      const reasons = text(wasm.celinen_intel_text()).split("\n");
      return frames.map((_, index) => {
        const at = index * sequenceOut;
        return {
          role: ROLES[rows[at]!] ?? "none",
          reason: reasons[index] ?? "",
          rank: rows[at + 1]!,
          burstSize: rows[at + 2]!,
          motion: rows[at + 3]!,
          atPeak: rows[at + 4] === 1,
          heads: readHeads(rows, at + 5),
        };
      });
    },

    release: () => wasm.celinen_intel_release(),
  };
}
