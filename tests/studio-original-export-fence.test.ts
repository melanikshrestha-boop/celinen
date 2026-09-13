import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const zipKeepers = async () => {");
const end = source.indexOf("  /* ---------------- assistant", start);
if (start < 0 || end < start) throw new Error("Original ZIP callback extraction failed");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
type Frame = { id: string; verdict: string; file: Blob; sourceAvailable?: boolean; error?: string };
const frame = (id: string, verdict = "keep"): Frame => ({ id, verdict, file: new Blob([id]) });

function fixture() {
  const original = frame("a");
  const scope = [original, frame("not-selected", "undecided")];
  const state = {
    mounted: { current: true },
    status: { current: "ready" },
    proposal: { current: null as object | null },
    latest: { current: [...scope] },
    flush: async () => true,
    packing: async () => {},
    clicks: 0,
    packed: [] as Frame[][],
    notes: [] as string[],
  };
  const bindings = {
    scopedShots: scope,
    mountedRef: state.mounted,
    sessionStatusRef: state.status,
    proposalRef: state.proposal,
    latestShotsRef: state.latest,
    canPersistStudioSession: (status: string) => status === "ready",
    repository: { flush: () => state.flush() },
    shootTitle: "Fixture",
    setBusy: () => {},
    setSyncNote: (note: string) => state.notes.push(note),
    createOriginalKeeperZip: async (frames: Frame[]) => {
      state.packed.push(frames);
      await state.packing();
      return { blob: new Blob(["zip"]), filename: "keepers.zip", keepers: frames.length };
    },
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL: () => {} },
    window: { setTimeout: () => 0 },
    document: {
      body: { appendChild: () => {} },
      createElement: () => ({
        href: "",
        download: "",
        click: () => {
          state.clicks++;
        },
        remove: () => {},
      }),
    },
  };
  const run = new Function(...Object.keys(bindings), code + "\nreturn zipKeepers;")(
    ...Object.values(bindings),
  ) as () => Promise<void>;
  return { state, scope, original, run };
}

for (const phase of ["flush", "packing"] as const) {
  for (const change of [
    "unmount",
    "pick",
    "source",
    "missing-source",
    "error",
    "proposal",
    "save-paused",
  ] as const) {
    test(`original ZIP does not click after ${change} during ${phase}`, async () => {
      const { state, run } = fixture();
      const mutate = () => {
        if (change === "unmount") state.mounted.current = false;
        if (change === "proposal") state.proposal.current = {};
        if (change === "save-paused") state.status.current = "conflicted";
        if (change === "pick")
          state.latest.current[0] = { ...state.latest.current[0]!, verdict: "reject" };
        if (change === "source")
          state.latest.current[0] = {
            ...state.latest.current[0]!,
            file: new Blob(["replacement"]),
          };
        if (change === "missing-source")
          state.latest.current[0] = { ...state.latest.current[0]!, sourceAvailable: false };
        if (change === "error")
          state.latest.current[0] = { ...state.latest.current[0]!, error: "unavailable" };
      };
      if (phase === "flush")
        state.flush = async () => {
          mutate();
          return true;
        };
      else
        state.packing = async () => {
          mutate();
        };
      await run();
      expect(state.clicks).toBe(0);
      expect(state.notes.at(-1)).toContain("changed");
      expect(state.packed).toHaveLength(phase === "flush" ? 0 : 1);
    });
  }
}
test("original ZIP exports only the request-time keeper set; later keepers cannot silently expand it", async () => {
  const { state, original, run } = fixture();
  state.flush = async () => {
    state.latest.current = [...state.latest.current, frame("new-keeper")];
    return true;
  };
  state.packing = async () => {
    state.latest.current[1] = { ...state.latest.current[1]!, verdict: "keep" };
  };
  await run();
  expect(state.clicks).toBe(1);
  expect(state.packed[0]?.map((f) => f.id)).toEqual(["a"]);
  expect(state.packed[0]?.[0]?.file).toBe(original.file);
  expect(state.notes.at(-1)).toContain("1 original keepers");
});
test("failed flush and preexisting proposal never create a ZIP", async () => {
  const { state, run } = fixture();
  state.flush = async () => false;
  await run();
  state.proposal.current = {};
  await run();
  expect(state.clicks).toBe(0);
  expect(state.packed).toHaveLength(0);
});
