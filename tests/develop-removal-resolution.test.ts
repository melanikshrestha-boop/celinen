import { describe, expect, test } from "bun:test";
import { removalRenderEdge, REMOVE_MAX_EDGE } from "../src/lib/develop/object-remove";
import { DEVELOP_ENGINE_LIMITS } from "../src/lib/develop/contract";

describe("Removal copy is independent of opt-in export resolution", () => {
  test("preserves existing export dimensions up to the removal cap", () => {
    for (const edge of [32, 1600, 2048, 4096]) expect(removalRenderEdge(edge)).toBe(edge);
  });
  test("bounds higher export choices without mutating shared export limits", () => {
    for (const edge of [4097, 6000, 8192]) expect(removalRenderEdge(edge)).toBe(REMOVE_MAX_EDGE);
    expect(DEVELOP_ENGINE_LIMITS.maxEdge).toBe(8192);
    expect(DEVELOP_ENGINE_LIMITS.defaultExportEdge).toBe(4096);
  });
  test("rejects invalid sizes before rendering or allocating pixels", () => {
    for (const edge of [0, 31, -1, 8192.5, NaN, Infinity])
      expect(() => removalRenderEdge(edge)).toThrow("Invalid removal render size");
  });
});
