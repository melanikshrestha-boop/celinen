/**
 * InsightFace matching in Celinen.
 *
 * Code (matching math) is MIT. buffalo_* / antelopev2 pretrained weights are
 * non-commercial research unless separately licensed. Celinen never auto-downloads
 * those packs. See native/INSIGHTFACE.md and
 * https://github.com/deepinsight/insightface
 */

export const INSIGHTFACE_EMBEDDING_DIM = 512;
export const INSIGHTFACE_REPO = "https://github.com/deepinsight/insightface";

export type EmbeddingSource = "insightface" | "local-descriptor";

export type FaceObservation = {
  id: string;
  frameId: string;
  source: EmbeddingSource;
  detScore: number;
  embedding: number[];
};

export type PersonCluster = {
  id: string;
  observationIds: string[];
  frameIds: string[];
  source: EmbeddingSource;
  minSimilarity: number;
  confidence: "matched" | "singleton";
};

export type PeopleReview = {
  clusters: PersonCluster[];
  unresolvedIds: string[];
  stats: {
    inputObservations: number;
    clusteredObservations: number;
    unresolvedObservations: number;
    comparisons: number;
    embeddingSource: EmbeddingSource | "mixed" | "none";
  };
  license: {
    code: "MIT";
    weights: "not-shipped";
    note: string;
  };
};

export type InsightFacePackStatus = {
  dir: string | null;
  detector: boolean;
  recognizer: boolean;
  complete: boolean;
  note: string;
};

const HEX = "0123456789abcdef";

export function encodeEmbedding(values: ArrayLike<number>): string {
  if (values.length !== INSIGHTFACE_EMBEDDING_DIM) {
    throw new Error("InsightFace embeddings are 512-d.");
  }
  let out = "";
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < INSIGHTFACE_EMBEDDING_DIM; i++) {
    const value = values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Invalid embedding component.");
    }
    view.setFloat32(0, value, true);
    for (let b = 0; b < 4; b++) {
      const byte = bytes[b]!;
      out += HEX[byte >> 4];
      out += HEX[byte & 15];
    }
  }
  return out;
}

export function l2Normalize(values: number[]): number[] | null {
  let norm = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    norm += value * value;
  }
  if (norm < 1e-12) return null;
  const scale = 1 / Math.sqrt(norm);
  return values.map((value) => value * scale);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return Math.max(-1, Math.min(1, dot));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export const INSIGHTFACE_WEIGHTS_NOTE =
  "InsightFace code is MIT. buffalo_* and antelopev2 pretrained weights are non-commercial research unless separately licensed. Celinen never auto-downloads them.";

export function insightfacePackStatus(
  env: Record<string, string | undefined> = {},
  home = "",
): InsightFacePackStatus {
  const dir = (env.FOTO_INSIGHTFACE_DIR ?? "").trim() || (home ? `${home}/.foto/insightface` : null);
  return {
    dir,
    detector: false,
    recognizer: false,
    complete: false,
    note: dir
      ? `Looking for det_10g.onnx and w600k_r50.onnx in ${dir}. Place a commercially licensed pack there. Celinen will not fetch buffalo weights.`
      : "No InsightFace pack directory. Set FOTO_INSIGHTFACE_DIR after you obtain a commercial license. Celinen never auto-downloads buffalo weights. Matching still runs on local 512-d descriptors.",
  };
}

/** Encode observations for the C++ people engine. Grouping/ranking execute there. */
export function peopleProtocol(faces: readonly FaceObservation[]): string {
  if (faces.length > 20_000) {
    throw new Error("People matching accepts at most 20,000 face observations.");
  }
  const ids = new Set<string>();
  const hex = (text: string) => {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 || code === 127) throw new Error("Invalid face observation identity.");
      out += HEX[(code >> 4) & 15];
      out += HEX[code & 15];
    }
    return out;
  };
  const lines = faces.map((face) => {
    if (!face.id || ids.has(face.id) || face.id.length > 512 || !face.frameId) {
      throw new Error("Invalid or repeated face observation.");
    }
    ids.add(face.id);
    if (face.source !== "insightface" && face.source !== "local-descriptor") {
      throw new Error("Unknown embedding source.");
    }
    if (!Number.isFinite(face.detScore) || face.detScore < 0 || face.detScore > 1) {
      throw new Error("Invalid detection score.");
    }
    if (face.embedding.length !== INSIGHTFACE_EMBEDDING_DIM) {
      throw new Error("InsightFace embeddings are 512-d.");
    }
    return `${hex(face.id)} ${hex(face.frameId)} ${face.source} ${face.detScore} ${encodeEmbedding(face.embedding)}`;
  });
  return `LENSPPL1 ${faces.length}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

export function validatePeopleResponse(
  value: unknown,
  observations: readonly FaceObservation[],
): PeopleReview {
  const fail = () => {
    throw new Error("Native people matching returned an invalid receipt. No identities were assigned.");
  };
  if (!object(value) || !Array.isArray(value.clusters) || !object(value.stats) || !object(value.license)) {
    return fail();
  }
  const stats = value.stats;
  if (
    !integer(stats.inputObservations, observations.length) ||
    stats.inputObservations !== observations.length ||
    !integer(stats.clusteredObservations, observations.length) ||
    !integer(stats.unresolvedObservations, observations.length) ||
    !integer(stats.comparisons, observations.length * observations.length) ||
    typeof stats.embeddingSource !== "string"
  ) {
    return fail();
  }
  if (value.license.code !== "MIT" || value.license.weights !== "not-shipped") return fail();
  const known = new Map(observations.map((face) => [face.id, face]));
  if (known.size !== observations.length) return fail();
  const assigned = new Set<string>();
  const clusterIds = new Set<string>();
  const clusters: PersonCluster[] = [];
  for (const cluster of value.clusters) {
    if (
      !object(cluster) ||
      typeof cluster.id !== "string" ||
      !/^person-\d+$/.test(cluster.id) ||
      clusterIds.has(cluster.id) ||
      (cluster.source !== "insightface" && cluster.source !== "local-descriptor") ||
      (cluster.confidence !== "matched" && cluster.confidence !== "singleton") ||
      typeof cluster.minSimilarity !== "number" ||
      !Array.isArray(cluster.observationIds) ||
      !Array.isArray(cluster.frameIds) ||
      cluster.observationIds.length < 1
    ) {
      return fail();
    }
    clusterIds.add(cluster.id);
    const frames = new Set<string>();
    for (const id of cluster.observationIds) {
      if (typeof id !== "string" || !known.has(id) || assigned.has(id)) return fail();
      assigned.add(id);
      frames.add(known.get(id)!.frameId);
    }
    if (cluster.frameIds.some((id) => typeof id !== "string" || !frames.has(id))) return fail();
    if (cluster.confidence === "matched" && cluster.observationIds.length < 2) return fail();
    if (cluster.confidence === "singleton" && cluster.observationIds.length !== 1) return fail();
    clusters.push(cluster as unknown as PersonCluster);
  }
  const unresolved = Array.isArray(value.unresolvedIds) ? value.unresolvedIds : fail();
  for (const id of unresolved) {
    if (typeof id !== "string" || !known.has(id) || assigned.has(id)) return fail();
    assigned.add(id);
  }
  if (assigned.size !== observations.length) return fail();
  if (assigned.size !== stats.clusteredObservations + stats.unresolvedObservations) return fail();
  return {
    clusters,
    unresolvedIds: unresolved as string[],
    stats: stats as unknown as PeopleReview["stats"],
    license: {
      code: "MIT",
      weights: "not-shipped",
      note: typeof value.license.note === "string" ? value.license.note : INSIGHTFACE_WEIGHTS_NOTE,
    },
  };
}

export async function requestPeopleClusters(
  faces: readonly FaceObservation[],
  options: { signal?: AbortSignal | undefined; fetch?: typeof fetch | undefined } = {},
): Promise<PeopleReview> {
  if (!faces.length) {
    return {
      clusters: [],
      unresolvedIds: [],
      stats: {
        inputObservations: 0,
        clusteredObservations: 0,
        unresolvedObservations: 0,
        comparisons: 0,
        embeddingSource: "none",
      },
      license: { code: "MIT", weights: "not-shipped", note: INSIGHTFACE_WEIGHTS_NOTE },
    };
  }
  if (new Set(faces.map((face) => face.id)).size !== faces.length) {
    throw new Error("People matching needs uniquely identified observations.");
  }
  const send =
    options.fetch ??
    (await import("@/lib/studio/native-client")).nativeStudioRequest;
  const response = await send("/__native/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ faces }),
    signal: options.signal ?? null,
  });
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? "The C++ engine is unavailable. Start the local native service, then retry. No identities were assigned."
        : `People matching could not finish (${response.status}). No identities were assigned.`,
    );
  }
  return validatePeopleResponse(await response.json(), faces);
}
