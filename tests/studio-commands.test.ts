import { describe, expect, test } from "bun:test";
import { parseLocalCommand } from "../src/lib/studio/commands";

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
});
