import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  applyProposal,
  proposeCull,
  proposeEdits,
  type StudioProposal,
} from "../src/lib/studio/proposals";

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
  test("a newer decision on an unchanged cull frame invalidates the whole preview", () => {
    const originals = [shot("protected", "keep"), shot("candidate")];
    const proposal = proposeCull(
      originals,
      (frame) => (frame.verdict === "undecided" ? "keep" : frame.verdict),
      details,
    );
    expect(proposal.frames.map((frame) => frame.id)).toEqual(["candidate"]);
    const changed = [{ ...originals[0]!, verdict: "reject" as const }, originals[1]!];
    expect(() => applyProposal(changed, proposal)).toThrow("shoot changed");
    expect(changed[1]!.verdict).toBe("undecided");
  });
  test("a replacement source with the same filename, size and timestamp needs a fresh preview", () => {
    const source = shot("same-name");
    const proposal = proposeEdits(
      [source],
      source.id,
      "selected",
      (frame) => ({ ...frame.edits, exposure: 10 }),
      details,
    );
    const replacement = new File(["different"], source.file.name, {
      lastModified: source.file.lastModified,
    });
    expect(replacement.size).toBe(source.file.size);
    expect(replacement.lastModified).toBe(source.file.lastModified);
    expect(() => applyProposal([{ ...source, file: replacement }], proposal)).toThrow(
      "shoot changed",
    );
    expect(source.edits.exposure).toBe(0);
  });
  test("changes to unchanged compared frames invalidate culls, including in-place metadata updates", () => {
    const updates: ((frame: Shot) => void)[] = [
      (frame) => {
        frame.edits.exposure = 12;
      },
      (frame) => {
        frame.flags.push("blur");
      },
      (frame) => {
        frame.score = 40;
      },
      (frame) => {
        frame.sharpness = 0;
      },
      (frame) => {
        frame.captureTimeMs = 1;
      },
      (frame) => {
        frame.hash = "0".repeat(64);
      },
      (frame) => {
        frame.relativePath = "different/source.jpg";
      },
      (frame) => {
        frame.sourceAvailable = false;
      },
      (frame) => {
        frame.develop!.rating = 5;
      },
      (frame) => {
        frame.error = "";
      },
    ];
    for (const update of updates) {
      const protectedFrame = {
        ...shot("protected", "keep"),
        develop: { origin: "sidecar" as const, at: 1, rating: 3 },
      };
      const originals = [shot("candidate"), protectedFrame];
      const proposal = proposeCull(
        originals,
        (frame) => (frame.verdict === "undecided" ? "keep" : frame.verdict),
        details,
      );
      update(protectedFrame);
      expect(() => applyProposal(originals, proposal)).toThrow("shoot changed");
      expect(originals[0]!.verdict).toBe("undecided");
      expect(originals[0]!.edits).toEqual(DEFAULT_EDITS);
    }
  });
  test("preview URL refresh and equivalent metadata objects keep the approval valid", () => {
    const originals = [shot("a"), shot("b", "keep")];
    const proposal = proposeCull(originals, () => "keep", details);
    const refreshed = originals
      .map((frame) => ({
        ...frame,
        previewUrl: `blob:new-${frame.id}`,
        previewBlob: new Blob(["thumbnail"]),
        edits: { ...frame.edits },
        flags: [...frame.flags],
      }))
      .reverse();
    const applied = applyProposal(refreshed, proposal);
    expect(applied.map((frame) => frame.id)).toEqual(["b", "a"]);
    expect(applied.map((frame) => frame.verdict)).toEqual(["keep", "keep"]);
    expect(applied[0]).toBe(refreshed[0]);
    expect(applied[1]!.file).toBe(originals[0]!.file);
  });
  test("selected edits ignore changes to unrelated sources and their review metadata", () => {
    const originals = [shot("a"), shot("b")];
    const proposal = proposeEdits(
      originals,
      "a",
      "selected",
      (frame) => ({ ...frame.edits, exposure: 8 }),
      details,
    );
    const unrelated = { ...shot("b", "reject"), flags: ["blur" as const], score: 0 };
    const applied = applyProposal([originals[0]!, unrelated], proposal);
    expect(applied[0]!.edits.exposure).toBe(8);
    expect(applied[1]).toBe(unrelated);
  });
  test("even an empty error excludes a photo from the approval scope", () => {
    const unreadable = { ...shot("unreadable"), error: "" };
    const originals = [shot("a"), unreadable];
    const cull = proposeCull(originals, () => "keep", details);
    const edit = proposeEdits(
      originals,
      "a",
      "all",
      (frame) => ({ ...frame.edits, exposure: 8 }),
      details,
    );
    for (const proposal of [cull, edit]) {
      expect(proposal.scopeIds).toEqual(["a"]);
      expect(proposal.frames.map((frame) => frame.id)).toEqual(["a"]);
      expect(applyProposal(originals, proposal)[1]).toBe(unreadable);
      expect(() =>
        applyProposal([originals[0]!, { ...unreadable, error: undefined } as Shot], proposal),
      ).toThrow("shoot changed");
    }
    expect(() =>
      proposeEdits(originals, "unreadable", "selected", (frame) => frame.edits, details),
    ).toThrow("readable photo");
  });
  test("duplicate source IDs cannot generate or accept an ambiguous preview", () => {
    const originals = [shot("a"), shot("a")];
    expect(() => proposeCull(originals, () => "keep", details)).toThrow(
      "Repeated source identifiers",
    );
    expect(() => proposeEdits(originals, "a", "selected", (frame) => frame.edits, details)).toThrow(
      "Repeated source identifiers",
    );
    const proposal = proposeCull([originals[0]!], () => "keep", details);
    expect(() => applyProposal(originals, proposal)).toThrow("shoot changed");
    expect(originals.every((frame) => frame.verdict === "undecided")).toBe(true);
  });
  test("old or inconsistent in-memory approval records cannot partially apply", () => {
    const originals = [shot("a"), shot("b")];
    const proposal = proposeCull(originals, () => "keep", details);
    const invalid: StudioProposal[] = [
      { ...proposal, scopeBasis: undefined } as unknown as StudioProposal,
      { ...proposal, scopeIds: ["a", "a"] },
      { ...proposal, scopeBasis: [proposal.scopeBasis[0]!, proposal.scopeBasis[0]!] },
      { ...proposal, scopeBasis: proposal.scopeBasis.slice(0, 1) },
      { ...proposal, scopeIds: ["a", "missing"] },
      { ...proposal, frames: [...proposal.frames, proposal.frames[0]!] },
      { ...proposal, frames: [...proposal.frames, { ...proposal.frames[0]!, id: "outside" }] },
    ];
    for (const stale of invalid) {
      expect(() => applyProposal(originals, stale)).toThrow("shoot changed");
      expect(originals.map((frame) => frame.verdict)).toEqual(["undecided", "undecided"]);
    }
  });
  test("preview edits do not retain a mutable alias returned by the transform", () => {
    const original = shot("a");
    const adjustments = { ...DEFAULT_EDITS, exposure: 8 };
    const proposal = proposeEdits([original], "a", "selected", () => adjustments, details);
    adjustments.exposure = 90;
    expect(proposal.frames[0]!.afterEdits.exposure).toBe(8);
    expect(applyProposal([original], proposal)[0]!.edits.exposure).toBe(8);
    expect(original.edits.exposure).toBe(0);
  });
  test("a change to the last unchanged frame in a 3000-photo cull rejects the whole batch", () => {
    const originals = Array.from({ length: 3000 }, (_, index) =>
      shot(String(index), index === 2999 ? "keep" : "undecided"),
    );
    const proposal = proposeCull(originals, () => "keep", details);
    expect(proposal.frames.length).toBe(2999);
    originals[2999]!.verdict = "reject";
    expect(() => applyProposal(originals, proposal)).toThrow("shoot changed");
    expect(originals.slice(0, 2999).every((frame) => frame.verdict === "undecided")).toBe(true);
    const fresh = proposeCull(
      originals,
      (frame) => (frame.verdict === "undecided" ? "keep" : frame.verdict),
      details,
    );
    const applied = applyProposal(originals, fresh);
    expect(applied[2999]!.verdict).toBe("reject");
    expect(applied.slice(0, 2999).every((frame) => frame.verdict === "keep")).toBe(true);
    expect(applied.every((frame, index) => frame.file === originals[index]!.file)).toBe(true);
  });
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
