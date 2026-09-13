import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Filmstrip } from "../src/components/studio/Filmstrip";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";

const frame = (id: string, verdict: Shot["verdict"], flags: Shot["flags"] = []): Shot => ({
  id,
  name: `${id}.jpg`,
  file: new File([id], `${id}.jpg`),
  isRaw: false,
  previewUrl: `blob:${id}`,
  sourceAvailable: true,
  width: 256,
  height: 256,
  sizeMb: 0.1,
  sharpness: 200,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 99,
  flags,
  verdict,
  edits: { ...DEFAULT_EDITS },
  develop: { origin: "lens os", at: 0 },
});

test("real contact sheet renders semantic review colors without score or origin badges", () => {
  const html = renderToStaticMarkup(
    createElement(Filmstrip, {
      shots: [
        frame("review", "undecided", ["soft"]),
        frame("kept", "keep"),
        frame("rejected", "reject"),
        frame("low-light", "undecided", ["underexposed"]),
      ],
      selectedId: "review",
      onSelect: () => {},
    }),
  );
  for (const dot of ["review", "keep", "reject", "pending"])
    expect(html).toContain(`data-cull-dot="${dot}"`);
  for (const color of ["#ef4444", "#16a34a", "#991b1b"]) expect(html).toContain(`bg-[${color}]`);
  expect(html).toContain("Check focus");
  expect(html).toContain("Kept");
  expect(html).toContain("Rejected");
  expect(html).toContain('tabindex="0"');
  expect(html).not.toContain(">99<");
  expect(html).not.toContain(">OS<");
  expect(html).not.toContain(">LR<");
});
