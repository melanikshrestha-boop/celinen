import { describe, expect, test } from "bun:test";
import { studioCommandRefusal, studioToolBoundary } from "../src/lib/studio/command-safety";
import { parseLocalCommand } from "../src/lib/studio/commands";

describe("Studio command safety boundary", () => {
  for (const request of [
    "do not export",
    "show keepers and don't export",
    "show keepers and don’t export",
    "don't cull this shoot",
    "keep top 40 and do not reject anything else",
    "export everything except my rejects",
    "export after I review",
    "export if the photos look good",
    "skip export and show keepers",
    "keep the top 40 without changing my picks",
    "make only the sky warmer",
    "make the keepers warmer but preserve skin tones",
    "crop the keepers unless faces are near the edge",
    "export tomorrow",
    "only export the sharpest photos",
    "cull all but leave the keeper decisions alone",
    "apply the preview and don't export",
    "cancel export",
    "stop export and show keepers",
    "maybe export keepers",
  ]) {
    test(`refuses the entire restricted request: ${request}`, () => {
      expect(studioCommandRefusal(request)).toContain("Nothing was run.");
    });
  }

  for (const request of [
    "show keepers",
    "export keepers",
    "keep only the top 40",
    "keep top 40",
    "cull the shoot and keep the top 40",
    "make only my keepers warmer",
    "brighten only the keepers",
    "make these warmer but keep them natural",
    "make it warmer and keep it looking natural",
    "make it black and white",
    "apply the edit",
    "discard the preview",
    "cancel",
    "undo",
    "send gallery",
    "send keepers",
    "send gallery tonight",
  ]) {
    test(`allows explicit supported intent: ${request}`, () => {
      expect(studioCommandRefusal(request)).toBeNull();
    });
  }

  test("denied export verbs never reach the legacy command executor", () => {
    const executed: string[] = [];
    for (const request of ["do not export", "show keepers and don't export"]) {
      // This boundary intentionally runs before any parser or hosted call.
      if (!studioCommandRefusal(request)) {
        for (const call of parseLocalCommand(request)?.calls ?? []) executed.push(call.name);
      }
    }
    expect(executed).toEqual([]);
  });

  test("bounds unusually long requests before scanning for executable verbs", () => {
    expect(studioCommandRefusal(`${"word ".repeat(300)}export`)).toContain("Nothing was run.");
  });
});

describe("tool execution stopping boundaries", () => {
  test("recognizes both failed and preview outcomes", () => {
    expect(studioToolBoundary("failed: no readable photos")).toBe("failed");
    expect(studioToolBoundary("  Failed: unknown studio command")).toBe("failed");
    expect(studioToolBoundary("Preview ready: warm keepers")).toBe("preview");
    expect(studioToolBoundary("showing keepers")).toBeNull();
  });

  test("a failed or previewed edit stops the batch before a following export", () => {
    for (const firstResult of ["failed: unreadable photo", "Preview ready: warmer"]) {
      const executed: string[] = [];
      for (const call of ["apply_edits", "export_keepers"]) {
        executed.push(call);
        if (studioToolBoundary(firstResult)) break;
      }
      expect(executed).toEqual(["apply_edits"]);
    }
  });
});
