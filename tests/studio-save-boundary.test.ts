import { describe, expect, test } from "bun:test";
import { StudioSaveBoundary } from "../src/lib/studio/save-boundary";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";

const photo = () => ({ id: "qa", edits: { ...DEFAULT_EDITS } }) as Shot;
const view = (shots: Shot[] = [photo()]) => ({ shots, selectedId: "qa", filter: "all" as const });

describe("Studio pending-save reload boundary", () => {
  test("protects an edit synchronously, before the autosave debounce begins", () => {
    const guard = new StudioSaveBoundary();
    const original = view();
    guard.begin(original)();
    expect(guard.pending(original)).toBe(false);
    const changed = view(original.shots.map((s) => ({ ...s, edits: { ...s.edits, exposure: 1 } })));
    expect(guard.pending(changed)).toBe(true);
  });

  test("queueing a save does not claim that its transaction committed", () => {
    const guard = new StudioSaveBoundary();
    const current = view();
    const acknowledge = guard.begin(current);
    expect(guard.pending(current)).toBe(true);
    acknowledge();
    expect(guard.pending(current)).toBe(false);
  });

  test("a completed older save cannot mark a newer adjustment as saved", () => {
    const guard = new StudioSaveBoundary();
    const previous = view();
    const finish = guard.begin(previous);
    const current = view();
    finish();
    expect(guard.pending(current)).toBe(true);
    guard.begin(current)();
    expect(guard.pending(current)).toBe(false);
  });

  test("failed writes leave the warning armed even after a previous save succeeded", async () => {
    const guard = new StudioSaveBoundary();
    const original = view();
    guard.begin(original)();
    const current = view();
    const commit = guard.begin(current);
    try {
      await Promise.reject(new Error("quota or cross-tab conflict"));
      commit();
    } catch {
      /* The route pauses saving and retains the pending snapshot. */
    }
    expect(guard.pending(current)).toBe(true);
  });

  test("out-of-order and duplicate acknowledgments cannot rewind the saved view", () => {
    const guard = new StudioSaveBoundary();
    const a = view(),
      b = view();
    const finishA = guard.begin(a),
      finishB = guard.begin(b);
    finishB();
    finishA();
    finishA();
    expect(guard.pending(b)).toBe(false);
    expect(guard.pending(a)).toBe(true);
  });

  test("selected photo and review filter are protected independently of frame edits", () => {
    const guard = new StudioSaveBoundary();
    const original = view();
    guard.begin(original)();
    expect(guard.pending({ ...original, selectedId: "another" })).toBe(true);
    expect(guard.pending({ ...original, filter: "keepers" })).toBe(true);
    expect(guard.pending({ ...original })).toBe(false);
  });

  test("account and shoot controllers never share acknowledgments", () => {
    const a = new StudioSaveBoundary(),
      b = new StudioSaveBoundary();
    const current = view();
    a.begin(current)();
    expect(a.pending(current)).toBe(false);
    expect(b.pending(current)).toBe(true);
  });

  test("empty shoots need no edit warning and snapshot wrappers are captured", () => {
    const guard = new StudioSaveBoundary();
    expect(guard.pending(view([]))).toBe(false);
    const original = view();
    const finish = guard.begin(original);
    original.selectedId = "changed after scheduling";
    finish();
    expect(guard.pending(original)).toBe(true);
  });
});
