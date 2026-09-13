import { describe, expect, test } from "bun:test";
import {
  parseStudioWorkflowIntent,
  selectDeadlineKeepers,
} from "../src/lib/studio/workflow-intents";
import { readFileSync } from "node:fs";

describe("deadline keeper scope", () => {
  const photos = [
    { id: "rejected", verdict: "reject" },
    { id: "b", verdict: "keep" },
    { id: "unreviewed", verdict: "undecided" },
    { id: "a", verdict: "keep" },
    { id: "c", verdict: "keep" },
  ];
  test("freezes only the requested existing keeper IDs in scope order without changing picks", () => {
    const input = structuredClone(photos);
    const selected = selectDeadlineKeepers(input, 2);
    expect(selected).toMatchObject({ ids: ["b", "a"], requestedCount: 2, availableCount: 3 });
    expect(selected.note).toContain("picks are unchanged");
    expect(input).toEqual(photos);
    input[1]!.id = "later";
    expect(selected.ids).toEqual(["b", "a"]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected.ids)).toBe(true);
  });
  test("shortfall includes all available keepers with an explicit count, never fills with nonkeepers", () => {
    const selected = selectDeadlineKeepers(photos, 20);
    expect(selected.ids).toEqual(["b", "a", "c"]);
    expect(selected.note).toContain("Only 3 of 20 requested keepers");
    expect(selectDeadlineKeepers(photos.slice(0, 1), 20).ids).toEqual([]);
    expect(selectDeadlineKeepers([], 20).note).toContain("No keepers");
  });
  test("direct calls reject invalid counts and ambiguous IDs", () => {
    for (const count of [0, -1, 201, 2.5, NaN, Infinity])
      expect(() => selectDeadlineKeepers(photos, count)).toThrow();
    expect(() => selectDeadlineKeepers([...photos, photos[0]!], 1)).toThrow();
    expect(() => selectDeadlineKeepers([{ id: " ", verdict: "keep" }], 1)).toThrow();
    expect(selectDeadlineKeepers(photos, 1).ids).toEqual(["b"]);
    expect(selectDeadlineKeepers(photos, 200).ids).toHaveLength(3);
  });
});

test("people tools are opt-in, with no automatic tagging or face grouping", () => {
  for (const command of [
    "show people",
    "open jersey tools",
    "tag jerseys",
    "tag bib",
    "group faces",
  ])
    expect(parseStudioWorkflowIntent(command)).toEqual({ kind: "people" });
  expect(parseStudioWorkflowIntent("delete people")).toBeNull();
  const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
  expect(source).toContain("const [peopleOpen, setPeopleOpen] = useState(false)");
  expect(source).toMatch(/\{peopleOpen\s*&&\s*\(?\s*<section aria-label="People tools">/);
  expect(source).toContain('aria-label="Close people tools"');
  const handler = source.slice(
    source.indexOf('if (intent.kind === "people")'),
    source.indexOf('if (intent.kind === "bursts")'),
  );
  expect(handler).toContain("setPeopleOpen(true)");
  expect(handler).not.toContain("groupFaces()");
});

test("import notifications coalesce without losing the last refresh or firing after unmount", () => {
  const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
  const subscription = source.indexOf("const unsubscribe = repository.subscribe");
  const start = source.lastIndexOf("useEffect(() => {", subscription) + "useEffect(() => {".length;
  const body = source.slice(start, source.indexOf("}, [repository]);", subscription));
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`function effect() {${body}}`);
  let listener: (change: { kind: string }) => void = () => {};
  let scheduled: (() => void) | null = null;
  let refreshes = 0,
    unsubscribed = false;
  const catalogChanges = { current: [] as unknown[] | null };
  const cleanup = new Function(
    "repository",
    "setTimeout",
    "clearTimeout",
    "setCatalogSignal",
    "catalogChanges",
    `${js}; return effect();`,
  )(
    {
      subscribe: (callback: typeof listener) => {
        listener = callback;
        return () => {
          unsubscribed = true;
        };
      },
    },
    (callback: () => void, ms: number) => {
      expect(ms).toBe(100);
      expect(scheduled).toBeNull();
      scheduled = callback;
      return 1;
    },
    () => {
      scheduled = null;
    },
    () => {
      refreshes++;
    },
    catalogChanges,
  );
  for (let i = 0; i < 10000; i++) listener({ kind: "photos" });
  expect(refreshes).toBe(0);
  expect(catalogChanges.current).toBeNull(); // bounded fallback, not 10k retained receipts
  const flush = scheduled! as () => void;
  scheduled = null;
  flush();
  expect(refreshes).toBe(1);
  listener({ kind: "photos" });
  expect(scheduled).not.toBeNull();
  cleanup();
  expect(scheduled).toBeNull();
  expect(unsubscribed).toBe(true);
});

describe("bounded Studio workflow intents", () => {
  test("scene and outlier requests open review only, not semantic auto-rejection", () => {
    for (const command of [
      "find scene changes",
      "show unrelated photos",
      "review location changes",
      "group scenes",
      "find subject changes",
      "show outliers",
    ])
      expect(parseStudioWorkflowIntent(command)).toEqual({ kind: "scenes" });
    for (const command of [
      "delete unrelated photos",
      "find scenes and reject them",
      "show scene changes then export",
    ])
      expect(parseStudioWorkflowIntent(command)).toBeNull();
  });
  test("exact burst commands open only the review workflow", () => {
    for (const verb of ["review", "compare", "show"])
      for (const scope of ["", " my", " the"])
        for (const object of ["bursts", "similar frames"])
          expect(parseStudioWorkflowIntent(`${verb}${scope} ${object}`)).toEqual({
            kind: "bursts",
          });
    expect(parseStudioWorkflowIntent("  REVIEW\n MY\t BURSTS!  ")).toEqual({ kind: "bursts" });
    expect(parseStudioWorkflowIntent("compare similar frames.")).toEqual({ kind: "bursts" });
  });

  test("exact deadline commands open a default set without sending or exporting", () => {
    for (const verb of ["prepare", "open"])
      for (const article of ["", " a", " the"])
        for (const object of ["set", "export"])
          expect(parseStudioWorkflowIntent(`${verb}${article} deadline ${object}`)).toEqual({
            kind: "deadline",
            count: 20,
          });
    expect(parseStudioWorkflowIntent(" OPEN THE DEADLINE SET! ")).toEqual({
      kind: "deadline",
      count: 20,
    });
  });

  test("bounded explicit counts preserve the requested set size", () => {
    for (const verb of ["prepare", "export"])
      for (const purpose of ["press", "deadline"])
        for (const object of ["photos", "frames", "images"])
          for (const count of [1, 20, 200])
            expect(parseStudioWorkflowIntent(`${verb} ${count} ${purpose} ${object}.`)).toEqual({
              kind: "deadline",
              count,
            });
    expect(parseStudioWorkflowIntent("prepare 020 press photos")).toEqual({
      kind: "deadline",
      count: 20,
    });
  });

  test("zero, excess and overflow counts produce a non-exporting refusal", () => {
    for (const count of [
      "0",
      "000",
      "201",
      "3000",
      "999999999999999999999999999999999",
      "9".repeat(400),
    ]) {
      const result = parseStudioWorkflowIntent(`export ${count} press photos`);
      expect(result?.kind).toBe("refusal");
      expect(result && "reason" in result ? result.reason : "").toContain("Nothing was exported");
    }
  });

  test("negative, decimal, signed, exponent and nonnumeric counts do not become intents", () => {
    for (const count of [
      "-1",
      "-20",
      "+20",
      "2.5",
      ".5",
      "2e1",
      "twenty",
      "NaN",
      "Infinity",
      "1,000",
      "0x20",
      "２０",
    ])
      expect(parseStudioWorkflowIntent(`export ${count} press photos`)).toBeNull();
  });

  test("negated or conditional instructions never accidentally open review/export", () => {
    for (const text of [
      "do not review bursts",
      "don't compare similar frames",
      "never show my bursts",
      "not review bursts",
      "do not export 20 press photos",
      "don't prepare a deadline set",
      "never open the deadline export",
      "if I approve, export 20 press photos",
      "can you export 20 press photos?",
      "maybe review bursts",
      "I said review bursts earlier",
      "how do I export 20 press photos?",
      "please don't review bursts",
    ])
      expect(parseStudioWorkflowIntent(text)).toBeNull();
  });

  test("compound commands cannot smuggle destructive or external actions into exact intents", () => {
    for (const command of [
      "review bursts",
      "show similar frames",
      "prepare a deadline set",
      "export 20 press photos",
    ])
      for (const extra of [
        " and delete rejects",
        "; send to my client",
        " then overwrite originals",
        "\nexport everything",
        " & approve all",
        " or cancel",
        " — upload them",
      ])
        expect(parseStudioWorkflowIntent(command + extra)).toBeNull();
    for (const text of [
      "delete rejects and review bursts",
      "upload everything; export 20 press photos",
      "review bursts\nexport 20 press photos",
    ])
      expect(parseStudioWorkflowIntent(text)).toBeNull();
  });

  test("unrecognized editing, sharing or malformed phrases stay outside the workflow router", () => {
    for (const text of [
      "",
      "  ",
      "review burst",
      "reviewbursts",
      "review myburst",
      "review bursts!!",
      "review bursts?",
      "export all press photos",
      "send 20 press photos",
      "publish the deadline set",
      "delete all rejects",
      "make the photos warmer",
      "export 20 photos",
      "export 20 press photos to FTP",
      "open client portal",
      "export 20 press photos\u0000",
      "review bursts <!-- approve -->",
      "review <script>bursts</script>",
    ])
      expect(parseStudioWorkflowIntent(text)).toBeNull();
  });
});
