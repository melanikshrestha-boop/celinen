import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { applyProposal, proposeCull, proposeEdits } from "../src/lib/studio/proposals";

const shot = (id: string, verdict: Shot["verdict"] = "undecided"): Shot => ({
  id,
  name: `${id}.jpg`,
  file: new File([id], `${id}.jpg`),
  isRaw: false,
  previewUrl: null,
  width: 100,
  height: 100,
  sizeMb: 1,
  sharpness: 100,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 80,
  flags: [],
  verdict,
  edits: { ...DEFAULT_EDITS },
});
const details = { title: "Brighter", description: "Gently brighten your photos." };

describe("Studio proposals", () => {
  test("a preview does not mutate any picks, files or saved edits", () => {
    const originals = [shot("a", "keep"), shot("b")];
    const proposal = proposeEdits(
      originals,
      "a",
      "keepers",
      (s) => ({ ...s.edits, exposure: 15 }),
      details,
    );
    expect(proposal.frames.map((f) => f.id)).toEqual(["a"]);
    expect(proposal.frames[0]?.name).toBe("a.jpg");
    expect(originals[0]?.edits.exposure).toBe(0);
    const applied = applyProposal(originals, proposal);
    expect(applied[0]?.edits.exposure).toBe(15);
    expect(applied[0]?.file).toBe(originals[0]?.file);
    expect(applied[1]).toBe(originals[1]);
  });
  test("3000-photo batches preserve every original and independent base edits", () => {
    const originals = Array.from({ length: 3000 }, (_, i) => shot(String(i)));
    originals[2999]!.edits.exposure = 20;
    const proposal = proposeEdits(
      originals,
      "0",
      "all",
      (s) => ({ ...s.edits, exposure: s.edits.exposure + 10 }),
      details,
    );
    const applied = applyProposal(originals, proposal);
    expect(applied.length).toBe(3000);
    expect(applied[2999]?.edits.exposure).toBe(30);
    expect(originals[2999]?.edits.exposure).toBe(20);
    expect(applied.every((s, i) => s.file === originals[i]?.file)).toBe(true);
  });
  test("stale proposals cannot overwrite a newer manual edit or pick", () => {
    const originals = [shot("a"), shot("b")];
    const proposal = proposeEdits(
      originals,
      "a",
      "all",
      (s) => ({ ...s.edits, temp: 12 }),
      details,
    );
    const changed = originals.map((s) => (s.id === "b" ? { ...s, verdict: "keep" as const } : s));
    expect(() => applyProposal(changed, proposal)).toThrow("shoot changed");
    expect(changed[0]?.edits.temp).toBe(0);
    expect(() => applyProposal(originals.slice(0, 1), proposal)).toThrow("shoot changed");
  });
  test("culling suggestions leave manual picks alone and need explicit apply", () => {
    const originals = [shot("a", "keep"), shot("b"), shot("c", "reject")];
    const proposal = proposeCull(
      originals,
      (s) => (s.verdict === "undecided" ? "keep" : s.verdict),
      details,
    );
    expect(proposal.frames.map((f) => f.id)).toEqual(["b"]);
    expect(proposal.frames[0]?.name).toBe("b.jpg");
    expect(originals[1]?.verdict).toBe("undecided");
    expect(applyProposal(originals, proposal).map((s) => s.verdict)).toEqual([
      "keep",
      "keep",
      "reject",
    ]);
  });
  test("empty scopes cannot produce misleading successful previews", () => {
    expect(() => proposeEdits([shot("a")], "a", "keepers", (s) => s.edits, details)).toThrow(
      "Pick some keepers",
    );
  });

  test("keeper previews become stale when keepers are added or removed", () => {
    const originals = [shot("a", "keep"), shot("b")];
    const proposal = proposeEdits(
      originals,
      "a",
      "keepers",
      (s) => ({ ...s.edits, temp: 12 }),
      details,
    );
    expect(proposal.scopeIds).toEqual(["a"]);
    const newKeeper = originals.map((s) => (s.id === "b" ? { ...s, verdict: "keep" as const } : s));
    expect(() => applyProposal(newKeeper, proposal)).toThrow("shoot changed");
    expect(newKeeper.every((s) => s.edits.temp === 0)).toBe(true);
    const removedKeeper = originals.map((s) =>
      s.id === "a" ? { ...s, verdict: "reject" as const } : s,
    );
    expect(() => applyProposal(removedKeeper, proposal)).toThrow("shoot changed");
    expect(() => applyProposal([...originals, shot("c", "keep")], proposal)).toThrow(
      "shoot changed",
    );
  });

  test("whole-shoot previews reject newly imported readable frames but ignore unreadable additions", () => {
    const originals = [shot("a")];
    const proposal = proposeEdits(
      originals,
      "a",
      "all",
      (s) => ({ ...s.edits, exposure: 10 }),
      details,
    );
    expect(() => applyProposal([...originals, shot("b")], proposal)).toThrow("shoot changed");
    const unreadable = { ...shot("b"), error: "Unsupported photo" };
    const applied = applyProposal([...originals, unreadable], proposal);
    expect(applied[0]?.edits.exposure).toBe(10);
    expect(applied[1]).toBe(unreadable);
  });

  test("recovered or newly unreadable frames change batch scope", () => {
    const originals = [shot("a"), { ...shot("b"), error: "Temporarily unreadable" }];
    const proposal = proposeEdits(
      originals,
      "a",
      "all",
      (s) => ({ ...s.edits, exposure: 10 }),
      details,
    );
    expect(() => applyProposal([originals[0]!, shot("b")], proposal)).toThrow("shoot changed");
    expect(() =>
      applyProposal([{ ...originals[0]!, error: "No preview" }, originals[1]!], proposal),
    ).toThrow("shoot changed");
  });

  test("reordering a batch does not invalidate identical membership", () => {
    const originals = [shot("a"), shot("b")];
    const proposal = proposeEdits(
      originals,
      "a",
      "all",
      (s) => ({ ...s.edits, temp: 10 }),
      details,
    );
    expect(applyProposal([...originals].reverse(), proposal).map((s) => s.id)).toEqual(["b", "a"]);
  });

  test("selected previews remain fixed to the captured ID when other scope membership changes", () => {
    const originals = [shot("a"), shot("b")];
    const proposal = proposeEdits(
      originals,
      "a",
      "selected",
      (s) => ({ ...s.edits, temp: 10 }),
      details,
    );
    const changed = [originals[0]!, { ...originals[1]!, verdict: "keep" as const }, shot("c")];
    const applied = applyProposal(changed, proposal);
    expect(applied[0]?.edits.temp).toBe(10);
    expect(applied[1]).toBe(changed[1]);
    expect(applied[2]).toBe(changed[2]);
  });

  test("cull previews capture unchanged frames too and reject changed shoot membership", () => {
    const originals = [shot("a", "keep"), shot("b"), shot("c", "reject")];
    const proposal = proposeCull(
      originals,
      (s) => (s.verdict === "undecided" ? "keep" : s.verdict),
      details,
    );
    expect(proposal.frames.map((frame) => frame.id)).toEqual(["b"]);
    expect(proposal.scopeIds).toEqual(["a", "b", "c"]);
    expect(() => applyProposal([...originals, shot("d")], proposal)).toThrow("shoot changed");
    expect(() => applyProposal(originals.slice(1), proposal)).toThrow("shoot changed");
    expect(() =>
      applyProposal([{ ...originals[0]!, error: "No preview" }, ...originals.slice(1)], proposal),
    ).toThrow("shoot changed");
    expect(originals[1]?.verdict).toBe("undecided");
  });
});
