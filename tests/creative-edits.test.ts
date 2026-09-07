import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Edits } from "../src/lib/imaging";
import {
  applyCreativeEdit,
  parseCreativeEdit,
  type CreativeEditPlan,
  type CreativeEditTarget,
} from "../src/lib/studio/creative-edits";

type AcceptedFixture = {
  input: string;
  target?: CreativeEditTarget;
  deltas?: CreativeEditPlan["deltas"];
  patch?: Partial<Edits>;
};

// This is a bounded deterministic language contract, not an AGI benchmark,
// perceptual quality measurement, real shoot success rate, or held-out corpus.
const accepted: AcceptedFixture[] = [
  { input: "brighten this", deltas: { exposure: 18 } },
  { input: "make it brighter", deltas: { exposure: 18 } },
  { input: "please brighten this photo", deltas: { exposure: 18 } },
  { input: "Can you make this a little brighter?", deltas: { exposure: 9 } },
  { input: "this is too dark", deltas: { exposure: 18 } },
  { input: "darken this", deltas: { exposure: -18 } },
  { input: "make it darker", deltas: { exposure: -18 } },
  { input: "this is too bright", deltas: { exposure: -18 } },
  { input: "make it warmer", deltas: { temp: 18 } },
  { input: "warm this up", deltas: { temp: 18 } },
  { input: "make this feel warmer", deltas: { temp: 18 } },
  { input: "make the keepers warmer", target: "keepers", deltas: { temp: 18 } },
  { input: "warm all my keepers slightly", target: "keepers", deltas: { temp: 9 } },
  { input: "make it much warmer", deltas: { temp: 27 } },
  { input: "make the whole shoot cooler", target: "all", deltas: { temp: -18 } },
  { input: "cool it down", deltas: { temp: -18 } },
  { input: "make the colors pop", deltas: { saturation: 20, contrast: 8 } },
  {
    input: "make the colours pop on the keepers",
    target: "keepers",
    deltas: { saturation: 20, contrast: 8 },
  },
  { input: "make all photos more vibrant", target: "all", deltas: { saturation: 20, contrast: 8 } },
  { input: "make it punchier", deltas: { saturation: 20, contrast: 8 } },
  { input: "tone down the colors", deltas: { saturation: -20 } },
  { input: "make it less vibrant", deltas: { saturation: -20 } },
  { input: "make it less harsh", deltas: { contrast: -15, highlights: -12, shadows: 8 } },
  { input: "soften the light", deltas: { contrast: -15, highlights: -12, shadows: 8 } },
  { input: "bring back the sky", deltas: { highlights: -25 } },
  { input: "recover the highlights", deltas: { highlights: -25 } },
  { input: "lift the dark areas", deltas: { shadows: 25 } },
  { input: "open up the shadows on the whole shoot", target: "all", deltas: { shadows: 25 } },
  { input: "bring out the shadow detail", deltas: { shadows: 25 } },
  { input: "make it black and white", patch: { saturation: -100 } },
  { input: "make the keepers black-and-white", target: "keepers", patch: { saturation: -100 } },
  { input: "convert this to black and white", patch: { saturation: -100 } },
  {
    input: "make this feel cinematic",
    deltas: { temp: -6, saturation: -10, contrast: 15, highlights: -12, shadows: 6 },
  },
  {
    input: "give it a cinematic look",
    deltas: { temp: -6, saturation: -10, contrast: 15, highlights: -12, shadows: 6 },
  },
  {
    input: "make it natural",
    patch: { exposure: 0, contrast: 0, temp: 0, saturation: 0, highlights: 0, shadows: 0 },
  },
  {
    input: "restore the natural colors",
    patch: { exposure: 0, contrast: 0, temp: 0, saturation: 0, highlights: 0, shadows: 0 },
  },
  { input: "crop this to a square", patch: { crop: "1:1" } },
  { input: "square crop", patch: { crop: "1:1" } },
  { input: "crop the keepers to 1:1", target: "keepers", patch: { crop: "1:1" } },
  { input: "portrait crop", patch: { crop: "4:5" } },
  { input: "crop this to portrait", patch: { crop: "4:5" } },
  { input: "crop everything to 4:5", target: "all", patch: { crop: "4:5" } },
  { input: "make it widescreen", patch: { crop: "16:9" } },
  { input: "crop all images to 16:9", target: "all", patch: { crop: "16:9" } },
  { input: "remove the crop", patch: { crop: "orig" } },
  { input: "restore the original framing", patch: { crop: "orig" } },
  { input: "brighten this and make it warmer", deltas: { exposure: 18, temp: 18 } },
  {
    input: "make all photos warmer and make the colors pop",
    target: "all",
    deltas: { temp: 18, saturation: 20, contrast: 8 },
  },
  { input: "make it black and white and crop to square", patch: { saturation: -100, crop: "1:1" } },
  {
    input: "make it cinematic and crop to widescreen",
    patch: { crop: "16:9" },
    deltas: { temp: -6, saturation: -10, contrast: 15, highlights: -12, shadows: 6 },
  },
  { input: "brighten the entire batch slightly", target: "all", deltas: { exposure: 9 } },
  { input: "make the selected photo more contrast", deltas: { contrast: 18 } },
  { input: "make these warmer but keep them natural", deltas: { temp: 9 } },
  { input: "make my keepers warmer but keep them natural", target: "keepers", deltas: { temp: 9 } },
  { input: "make only my keepers warmer", target: "keepers", deltas: { temp: 18 } },
  { input: "brighten only the keepers", target: "keepers", deltas: { exposure: 18 } },
];

const refused = [
  "make it warmer but do not crop",
  "don't brighten this",
  "do not crop this photo",
  "make it warmer without changing skin",
  "make the colors pop and preserve skin tones",
  "bring back only the sky",
  "brighten the player but not the background",
  "make it warmer except the jersey",
  "remove the background",
  "make it brighter and remove the logo",
  "match this photo to my reference",
  "make it cinematic and add film grain",
  "sharpen the ball",
  "make it brighter and export",
  "crop to square then send to the client",
  "make it warmer and dance",
  "brighten this and",
  "warm this by 5000 degrees",
  "make this warmer and cooler",
  "make it brighter and darker",
  "make it black and white and more vibrant",
  "crop to square and crop to widescreen",
  "make this photo and all photos warmer",
  "make this very slightly warmer",
  "make it natural and warmer",
  "make it slightly black and white",
  "make it a subtle square crop",
  "make the selected photos brighter",
  "crop this if it looks better",
  "do not change skin and make it warmer",
  "make it warmer but keep the skin natural",
  "make only the sky warmer",
  "make only my keepers warmer without cropping",
  "make these very warmer but keep them natural",
];

describe("bounded plain-English creative-edit acceptance contract", () => {
  for (const fixture of accepted) {
    test(fixture.input, () => {
      const result = parseCreativeEdit(fixture.input);
      expect(result?.kind).toBe("plan");
      if (result?.kind !== "plan") throw new Error(JSON.stringify(result));
      expect(result.target).toBe(fixture.target ?? "selected");
      expect(result.deltas).toEqual(fixture.deltas ?? {});
      expect(result.patch).toEqual(fixture.patch ?? {});
      expect(result.description).toBeTruthy();
      expect(result.limitations.length).toBeGreaterThan(0);
    });
  }

  for (const input of refused) {
    test(`safely declines: ${input}`, () => {
      const result = parseCreativeEdit(input);
      expect(result?.kind).toBe("unsupported");
      if (result?.kind === "unsupported")
        expect(result.reason).toContain("Nothing has been changed.");
    });
  }
});

describe("creative-edit application safety", () => {
  test("leaves non-edit commands to their own router", () => {
    for (const input of [
      "",
      "import photos",
      "keep top 100",
      "show keepers",
      "undo",
      "export",
      "hello",
      "reject blur",
      "reject all blurred or duplicate photos",
      "reject all too dark photos",
      "show brightest photo",
      "open the darkest photo",
      "auto-edit keepers",
    ]) {
      expect(parseCreativeEdit(input)).toBeNull();
    }
  });

  test("evaluates relative edits per photo without mutating originals", () => {
    const plan = parseCreativeEdit("make all photos warmer");
    if (plan?.kind !== "plan") throw new Error("Expected a plan");
    const original = Object.freeze({ ...DEFAULT_EDITS, temp: 10, crop: "4:5" as const });
    expect(applyCreativeEdit(original, plan)).toEqual({ ...original, temp: 28 });
    expect(applyCreativeEdit({ ...original, temp: -10 }, plan).temp).toBe(8);
    expect(original.temp).toBe(10);
  });

  test("clamps to the actual editor range and preserves untouched settings", () => {
    const plan = parseCreativeEdit("make it much warmer and brighter");
    if (plan?.kind !== "plan") throw new Error("Expected a plan");
    expect(
      applyCreativeEdit({ ...DEFAULT_EDITS, exposure: 90, temp: 99, shadows: 30 }, plan),
    ).toEqual({ ...DEFAULT_EDITS, exposure: 100, temp: 100, shadows: 30 });
    const dark = parseCreativeEdit("make it darker");
    if (dark?.kind !== "plan") throw new Error("Expected a plan");
    expect(applyCreativeEdit({ ...DEFAULT_EDITS, exposure: -99 }, dark).exposure).toBe(-100);
  });

  test("a natural reset preserves crop and is explicitly described", () => {
    const plan = parseCreativeEdit("make it natural");
    if (plan?.kind !== "plan") throw new Error("Expected a plan");
    const original = { ...DEFAULT_EDITS, exposure: 30, saturation: 20, crop: "1:1" as const };
    expect(applyCreativeEdit(original, plan)).toEqual({ ...DEFAULT_EDITS, crop: "1:1" });
    expect(plan.description).toContain("keeping the current crop");
    expect(original.exposure).toBe(30);
  });

  test("explains highlight recovery and crop limits", () => {
    const sky = parseCreativeEdit("bring back the sky");
    const crop = parseCreativeEdit("portrait crop");
    if (sky?.kind !== "plan" || crop?.kind !== "plan") throw new Error("Expected plans");
    expect(sky.limitations.join(" ")).toContain("cannot reconstruct a clipped sky");
    expect(crop.limitations.join(" ")).toContain("not subject tracking");
  });

  test("does not double an identical request repeated in one message", () => {
    const result = parseCreativeEdit("brighten this and brighten this");
    if (result?.kind !== "plan") throw new Error("Expected a plan");
    expect(result.deltas).toEqual({ exposure: 18 });
  });

  test("keep it natural is a restrained relative edit, not a reset", () => {
    const result = parseCreativeEdit("make these warmer but keep them natural");
    if (result?.kind !== "plan") throw new Error("Expected a plan");
    expect(applyCreativeEdit({ ...DEFAULT_EDITS, temp: 20, contrast: 10 }, result)).toEqual({
      ...DEFAULT_EDITS,
      temp: 29,
      contrast: 10,
    });
    expect(result.limitations.join(" ")).toContain("not skin-tone protection");
  });
});
