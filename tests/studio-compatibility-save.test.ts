import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { StudioSaveBoundary } from "../src/lib/studio/save-boundary";
import type { Shot } from "../src/lib/imaging";

// Run the actual route callback with instance-local dependencies: no React or
// module mocks can contaminate another test file or touch account storage.
const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const saveStoredSession = useCallback(");
const end = source.indexOf("  const [shots, setShots]", start);
if (start < 0 || end < 0) throw new Error("Studio save boundary missing");
const body = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
const loadStart = source.indexOf("  const loadStoredSession = useCallback(");
const loadBody = new Bun.Transpiler({ loader: "tsx" }).transformSync(
  source.slice(loadStart, start),
);
const mergeStart = source.indexOf("function mergeStudioSubjects(");
const mergeBody =
  mergeStart < 0
    ? ""
    : new Bun.Transpiler({ loader: "tsx" }).transformSync(
        source.slice(mergeStart, source.indexOf("export function Studio(", mergeStart)),
      );
type View = { shots: Shot[]; selectedId: string | null; filter: "all" };
const view = (subjects?: string[]) => ({
  shots: [{ id: "synthetic-photo", ...(subjects ? { subjects } : {}) }] as unknown as Shot[],
  selectedId: "synthetic-photo",
  filter: "all" as const,
});
function fixture(initial = view()) {
  const calls: string[] = [];
  const saveBoundary = new StudioSaveBoundary();
  const canonicalReadView = { current: initial as View | null };
  const peopleEpoch = { current: 0 };
  const compatibilitySave = {
    current: null as (View & { peopleEpoch: number; sequence: number }) | null,
  };
  const compatibilitySequence = { current: 0 };
  const committedPeopleEpoch = { current: 0 };
  let fail = false;
  let duringCanonical: (() => Promise<void>) | undefined;
  const save = new Function(
    "useCallback",
    "saveBoundary",
    "canonicalReadView",
    "peopleEpoch",
    "compatibilitySave",
    "compatibilitySequence",
    "committedPeopleEpoch",
    "canonicalView",
    "saveStudioSession",
    "projectSession",
    "storageScope",
    "shootId",
    "rememberShoot",
    "describeShoot",
    body + "\nreturn saveStoredSession;",
  )(
    (callback: unknown) => callback,
    saveBoundary,
    canonicalReadView,
    peopleEpoch,
    compatibilitySave,
    compatibilitySequence,
    committedPeopleEpoch,
    {
      save: async () => {
        calls.push("canonical");
        await duringCanonical?.();
      },
    },
    async () => {
      calls.push("compatibility");
      if (fail) throw new Error("synthetic quota");
    },
    {},
    "synthetic-account",
    "synthetic-shoot",
    async () => {},
    () => ({ title: "Synthetic" }),
  ) as (
    shots: Shot[],
    selected: string | null,
    filter: "all",
    mirrorLegacy?: boolean,
  ) => Promise<void>;
  return {
    calls,
    saveBoundary,
    canonicalReadView,
    peopleEpoch,
    compatibilitySave,
    compatibilitySequence,
    committedPeopleEpoch,
    save: (next = initial, mirrorLegacy?: boolean) =>
      save(next.shots, next.selectedId, next.filter, mirrorLegacy),
    set fail(value: boolean) {
      fail = value;
    },
    set duringCanonical(value: (() => Promise<void>) | undefined) {
      duringCanonical = value;
    },
  };
}

describe("Studio compatibility save acknowledgment", () => {
  test("subject overlay cannot change source identity or canonical review and accepts explicit untagging", () => {
    const merge = new Function(mergeBody + "\nreturn mergeStudioSubjects;") as () => (
      next: Shot,
      prior: Shot,
    ) => Shot;
    const apply = merge();
    const projected = {
      ...view().shots[0]!,
      sourceDigest: "source-a",
      verdict: "keep",
      develop: {
        canonical: { namespace: "owner-a/shoot-a", photoId: "synthetic-photo" },
        rating: 5,
      },
    } as Shot;
    const prior = { ...projected, verdict: "reject", subjects: [] } as Shot;
    const result = apply(projected, prior);
    expect(result.subjects).toEqual([]);
    expect(result.subjects).not.toBe(prior.subjects);
    expect(result.verdict).toBe("keep");
    expect(result.develop).toBe(projected.develop);
    for (const wrong of [
      { ...prior, id: "another-photo" },
      { ...prior, sourceDigest: "source-b" },
      {
        ...prior,
        develop: {
          ...prior.develop,
          canonical: { namespace: "owner-b/shoot-a", photoId: "synthetic-photo" },
        },
      },
      {
        ...prior,
        develop: {
          ...prior.develop,
          canonical: { namespace: "owner-a/shoot-a", photoId: "another-copy" },
        },
      },
    ])
      expect(apply(projected, wrong as Shot)).toBe(projected);
    expect(source).toContain(
      "mergeStudioSubjects(mergePreservedImportAnalysis(shot, old.get(shot.id)), old.get(shot.id))",
    );
  });

  test("hydration restores only the matching validated legacy subject metadata", async () => {
    const canonical = { namespace: "synthetic-account/shoot", photoId: "synthetic-photo" };
    const projected = {
      ...view().shots[0]!,
      sourceDigest: "synthetic-digest",
      develop: { canonical },
    };
    const tagged = { ...projected, subjects: [{ personId: "synthetic-person", confirmed: true }] };
    const legacy = { shots: [tagged] };
    const load = new Function(
      "useCallback",
      "projectSession",
      "canonicalView",
      "unanalyzedIds",
      "nativeTreatmentIds",
      "storageScope",
      "shootId",
      mergeBody + loadBody + "\nreturn loadStoredSession;",
    )(
      (callback: unknown) => callback,
      { load: async () => legacy },
      {
        read: async (input: unknown) => {
          expect(input).toBe(legacy);
          return { shots: [projected], unanalyzedIds: new Set(), nativeTreatmentIds: new Set() };
        },
      },
      { current: new Set() },
      { current: new Set() },
      "synthetic-account",
      "synthetic-shoot",
    );
    const restored = await load();
    expect(restored.shots[0].subjects).toEqual(tagged.subjects);
    expect(restored.shots[0].develop).toEqual(projected.develop);
  });

  test("roster or event-person edits persist even when the photo view was already acknowledged", async () => {
    const current = view();
    const f = fixture(current);
    f.saveBoundary.begin(current)();
    f.peopleEpoch.current++;
    await f.save();
    expect(f.calls).toEqual(["canonical", "compatibility"]);
    expect(f.committedPeopleEpoch.current).toBe(1);
  });

  test("an import refresh must mirror a genuine subject-tag edit before acknowledging it", async () => {
    const original = view(),
      tagged = view(["synthetic-person"]);
    const f = fixture(original);
    f.saveBoundary.begin(original)();
    await f.save(tagged, false);
    expect(f.calls).toEqual(["canonical", "compatibility"]);
    expect(f.saveBoundary.pending(tagged)).toBe(false);
    await f.save(tagged);
    expect(f.calls).toEqual(["canonical", "compatibility"]);
  });

  test("unchanged canonical projections require no whole-library compatibility mirror", async () => {
    const current = view(),
      f = fixture(current);
    await f.save();
    await f.save();
    expect(f.calls).toEqual(["canonical"]);
    expect(f.saveBoundary.pending(current)).toBe(false);
  });

  test("a failed compatibility write keeps the gesture pending and can retry", async () => {
    const current = view(),
      tagged = view(["synthetic-person"]),
      f = fixture(current);
    f.fail = true;
    await expect(f.save(tagged, false)).rejects.toThrow("synthetic quota");
    expect(f.saveBoundary.pending(tagged)).toBe(true);
    expect(f.compatibilitySave.current).toBeNull();
    f.fail = false;
    await f.save(tagged);
    expect(f.saveBoundary.pending(tagged)).toBe(false);
    expect(f.calls).toEqual(["canonical", "compatibility", "canonical", "compatibility"]);
  });

  test("people edits arriving during an awaited save cannot be acknowledged by its older capture", async () => {
    const f = fixture();
    f.peopleEpoch.current = 1;
    f.duringCanonical = async () => {
      f.peopleEpoch.current = 2;
    };
    await f.save();
    expect(f.committedPeopleEpoch.current).toBe(1);
    f.duringCanonical = undefined;
    await f.save();
    expect(f.committedPeopleEpoch.current).toBe(2);
    expect(f.calls).toEqual(["canonical", "compatibility", "canonical", "compatibility"]);
  });

  test("an explicit empty snapshot still reaches compatibility storage", async () => {
    const empty: View = { shots: [], selectedId: null, filter: "all" };
    const f = fixture(empty);
    await f.save();
    expect(f.calls).toEqual(["canonical", "compatibility"]);
  });

  test("people-only failures remain dirty and separate account controllers cannot acknowledge each other", async () => {
    const current = view(),
      a = fixture(current),
      b = fixture(current);
    a.saveBoundary.begin(current)();
    b.saveBoundary.begin(current)();
    a.peopleEpoch.current = b.peopleEpoch.current = 1;
    a.fail = true;
    await expect(a.save()).rejects.toThrow("synthetic quota");
    expect(a.peopleEpoch.current).not.toBe(a.committedPeopleEpoch.current);
    await b.save();
    expect(b.committedPeopleEpoch.current).toBe(1);
    expect(a.committedPeopleEpoch.current).toBe(0);
    expect(source).toContain("peopleEpoch.current !== committedPeopleEpoch.current ||");
    expect(source.match(/peopleEpoch\.current\+\+/g)).toHaveLength(3);
  });
});
