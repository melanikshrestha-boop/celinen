import { describe, expect, test } from "bun:test";
import {
  cosineSimilarity,
  encodeEmbedding,
  INSIGHTFACE_EMBEDDING_DIM,
  INSIGHTFACE_WEIGHTS_NOTE,
  insightfacePackStatus,
  l2Normalize,
  peopleProtocol,
  validatePeopleResponse,
  type FaceObservation,
} from "../src/lib/studio/insightface";

function unit(index = 0): number[] {
  const values = Array.from({ length: INSIGHTFACE_EMBEDDING_DIM }, () => 0);
  values[index] = 1;
  return values;
}

function observation(id: string, frameId: string, embedding = unit()): FaceObservation {
  return { id, frameId, source: "insightface", detScore: 0.9, embedding };
}

describe("InsightFace matching protocol", () => {
  test("does not invent a pack and never promises buffalo weights", () => {
    const status = insightfacePackStatus({}, "");
    expect(status.complete).toBe(false);
    expect(status.note).toContain("buffalo");
    expect(INSIGHTFACE_WEIGHTS_NOTE).toContain("non-commercial");
    expect(INSIGHTFACE_WEIGHTS_NOTE).toContain("never auto-downloads");
  });

  test("cosine of aligned ArcFace-sized vectors matches InsightFace compute_sim", () => {
    const a = l2Normalize(unit(0))!;
    const b = l2Normalize(unit(1))!;
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  test("protocol encodes 512-d little-endian embeddings for the C++ engine", () => {
    const faces = [observation("obs-a", "frame-a")];
    const encoded = peopleProtocol(faces);
    expect(encoded.startsWith("LENSPPL1 1\n")).toBe(true);
    expect(encoded).toContain("insightface");
    expect(encodeEmbedding(unit()).length).toBe(4096);
    expect(encoded).toContain(encodeEmbedding(unit()));
  });

  test("a valid C++ receipt is accepted and names are not inferred", () => {
    const faces = [observation("obs-a", "frame-a"), observation("obs-b", "frame-b")];
    const review = validatePeopleResponse(
      {
        clusters: [
          {
            id: "person-1",
            observationIds: ["obs-a", "obs-b"],
            frameIds: ["frame-a", "frame-b"],
            source: "insightface",
            minSimilarity: 0.81,
            confidence: "matched",
          },
        ],
        unresolvedIds: [],
        stats: {
          inputObservations: 2,
          clusteredObservations: 2,
          unresolvedObservations: 0,
          comparisons: 1,
          embeddingSource: "insightface",
        },
        license: {
          code: "MIT",
          weights: "not-shipped",
          note: INSIGHTFACE_WEIGHTS_NOTE,
        },
      },
      faces,
    );
    expect(review.clusters[0]?.id).toBe("person-1");
    expect(review.license.weights).toBe("not-shipped");
  });

  test("a named identity in the receipt is rejected", () => {
    const faces = [observation("obs-a", "frame-a")];
    expect(() =>
      validatePeopleResponse(
        {
          clusters: [
            {
              id: "Jane Doe",
              observationIds: ["obs-a"],
              frameIds: ["frame-a"],
              source: "insightface",
              minSimilarity: 1,
              confidence: "singleton",
            },
          ],
          unresolvedIds: [],
          stats: {
            inputObservations: 1,
            clusteredObservations: 1,
            unresolvedObservations: 0,
            comparisons: 0,
            embeddingSource: "insightface",
          },
          license: { code: "MIT", weights: "not-shipped", note: "x" },
        },
        faces,
      ),
    ).toThrow(/invalid receipt/i);
  });
});
