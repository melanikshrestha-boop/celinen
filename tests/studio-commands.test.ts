import { describe, expect, test } from "bun:test";
import { parseLocalCommand, STUDIO_TOOL_DEFINITIONS } from "../src/lib/studio/commands";

describe("conservative cull command contract", () => {
  const cull = STUDIO_TOOL_DEFINITIONS.find((tool) => tool.function.name === "cull")!.function;

  test("describes a review proposal without promising automatic rejection", () => {
    expect(cull.description).toMatch(/preview/i);
    expect(cull.description).toMatch(/undecided/i);
    expect(cull.description).toMatch(/preserve existing decisions/i);
    expect(cull.description).toMatch(/no new rejections/i);
    expect(cull.description).toMatch(/approval/i);
  });

  test("retains min_score compatibility without offering a rejection cutoff", () => {
    expect(cull.parameters.properties.min_score.type).toBe("number");
    expect(cull.parameters.properties.min_score.description).toMatch(/compatibility/i);
    expect(cull.parameters.properties.min_score.description).toMatch(/not a rejection cutoff/i);
    expect(parseLocalCommand("cull the shoot reject below 45 keep at 85")?.calls).toEqual([
      { name: "cull", args: { min_score: 45, keep_score: 85 } },
    ]);
  });

  test("does not promise every high score becomes a keep", () => {
    expect(cull.parameters.properties.keep_score.description).toMatch(/eligible undecided/i);
    expect(cull.parameters.properties.keep_score.description).toMatch(/suggest/i);
    expect(cull.parameters.properties.keep_score.description).toMatch(/review/i);
  });

  test("the retained local reply explains cull policy without claiming execution", () => {
    const reply = parseLocalCommand("cull the shoot reject below 45")!.reply;
    expect(reply).toMatch(/matched/i);
    expect(reply).toMatch(/cull preserves existing decisions/i);
    expect(reply).toMatch(/no new rejections/i);
    expect(reply).toMatch(/min_score.*compatibility/i);
    expect(reply).not.toMatch(/\b(?:done|ran|saved|rejected|completed)\b/i);
  });

  test("explicit rejection tools retain their separate authorization semantics", () => {
    expect(parseLocalCommand("cull the shoot and reject blurred")?.calls).toEqual([
      { name: "cull", args: {} },
      { name: "reject_flagged", args: { flags: ["blur"] } },
    ]);
    expect(parseLocalCommand("keep only the top 40")?.calls).toEqual([
      { name: "keep_top", args: { n: 40 } },
    ]);
    expect(
      STUDIO_TOOL_DEFINITIONS.find((tool) => tool.function.name === "keep_top")!.function
        .description,
    ).toBe("Keep only the N highest-scoring frames and reject everything else.");
    expect(
      STUDIO_TOOL_DEFINITIONS.find((tool) => tool.function.name === "reject_flagged")!.function
        .description,
    ).toBe("Reject every frame carrying any of the given flags.");
  });

  test("batch and undo summaries do not claim unexecuted steps succeeded", () => {
    for (const input of [
      "cull the shoot and keep the top 40",
      "reject blurred and export",
      "undo",
    ]) {
      const reply = parseLocalCommand(input)!.reply;
      expect(reply).toMatch(/matched/i);
      expect(reply).not.toMatch(/\b(?:done|undone|ran|saved|rejected|completed)\b/i);
      expect(reply).not.toMatch(/^preview ready:/i);
    }
    expect(parseLocalCommand("cull the shoot and keep the top 40")!.reply).toMatch(
      /cull preserves existing decisions/i,
    );
  });
});

describe("parseLocalCommand", () => {
  test("plans a multi-step cull", () => {
    expect(parseLocalCommand("cull the shoot and keep the top 40")?.calls).toEqual([
      { name: "cull", args: {} },
      { name: "keep_top", args: { n: 40 } },
    ]);
  });

  test("maps photographer language to quality flags", () => {
    expect(parseLocalCommand("reject everything blurred or duplicate")?.calls).toEqual([
      { name: "reject_flagged", args: { flags: ["blur", "duplicate"] } },
    ]);
  });

  test("can edit and export in one command", () => {
    expect(parseLocalCommand("warm the keepers slightly and export")?.calls).toEqual([
      { name: "apply_edits", args: { target: "keepers", temperature: 12 } },
      { name: "export_keepers", args: {} },
    ]);
  });

  test("supports navigation and reversible commands", () => {
    expect(parseLocalCommand("show flagged")?.calls).toEqual([
      { name: "set_filter", args: { filter: "flagged" } },
    ]);
    expect(parseLocalCommand("open best")?.calls).toEqual([
      { name: "select_photo", args: { query: "best" } },
    ]);
    expect(parseLocalCommand("undo")?.calls).toEqual([{ name: "undo_last", args: {} }]);
  });

  test("leaves open-ended requests to the optional hosted planner", () => {
    expect(parseLocalCommand("make this feel cinematic")).toBeNull();
  });

  test("sends a same-night keeper gallery", () => {
    expect(parseLocalCommand("send gallery tonight")?.calls).toEqual([
      { name: "send_gallery", args: {} },
    ]);
    expect(parseLocalCommand("send keepers")?.calls).toEqual([{ name: "send_gallery", args: {} }]);
    expect(parseLocalCommand("send to lightroom")?.calls).toEqual([
      { name: "write_xmp", args: {} },
    ]);
  });
});
