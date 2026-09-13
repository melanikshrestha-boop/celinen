import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { GalleryPresentationForm } from "../src/components/delivery/GalleryPresentationForm";
import {
  galleryCovers,
  galleryDesign,
  galleryDesignSchema,
  galleryPresentationSchema,
} from "../src/lib/delivery/gallery-presentation";
import {
  newDelivery,
  transition,
  clientState,
  type DeliveryCommand,
  type DeliveryState,
  type VersionInput,
} from "../src/lib/delivery/workflow";

const now = "2026-09-13T12:00:00.000Z";
const id = () => crypto.randomUUID();
function draft() {
  return newDelivery(
    {
      id: id(),
      title: "Final whistle",
      clientName: "Team",
      message: "",
      selectionLimit: 10,
      expiresAt: "2026-10-13T12:00:00.000Z",
    },
    now,
  );
}
function apply(
  s: DeliveryState,
  command: DeliveryCommand | { type: "complete"; versionId: string },
  actor: "owner" | "client" = "owner",
) {
  return transition(s, command, actor, id(), JSON.stringify(command), now);
}
function photo(s: DeliveryState, photoId = id()) {
  const rendition = { sha256: "a".repeat(64), bytes: 100, width: 1200, height: 800 };
  const v: VersionInput = {
    id: id(),
    photoId,
    filename: "finish.jpg",
    source: null,
    variants: { proof: rendition, phone: rendition, full: rendition },
  };
  s = apply(s, { type: "reserve", version: v });
  return { state: apply(s, { type: "complete", versionId: v.id }), v };
}
const presentation = (ids: string[]) => ({
  studioName: "Event studio",
  showLensLabsCredit: false,
  design: galleryDesignSchema.parse({
    font: "editorial",
    theme: "light",
    layout: "natural",
    spacing: "compact",
    coverVersionIds: ids,
  }),
});

describe("gallery-specific design and exact covers", () => {
  test("explicit client themes cover the viewport, but never the owner workspace or preview", () => {
    const css = readFileSync(
      new URL("../src/components/delivery/delivery.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain('body:has(.delivery-client[data-gallery-theme="light"])');
    expect(css).toContain('body:has(.delivery-client[data-gallery-theme="dark"])');
    expect(css).not.toContain("body:has(.delivery-client-preview");
    expect(css).not.toContain("body:has(.delivery-workspace");
  });
  test("old records keep original styling and require no migration", () => {
    const state = draft();
    expect(galleryDesign(state)).toEqual({
      font: "inherit",
      theme: "inherit",
      layout: "grid",
      spacing: "comfortable",
      coverVersionIds: [],
    });
    expect(state.presentation).toBeUndefined();
    expect(galleryPresentationSchema.parse({ studioName: "", showLensLabsCredit: true })).toEqual({
      studioName: "",
      showLensLabsCredit: true,
    });
  });
  test("bounded font/theme/layout choices reject CSS and external resources", () => {
    for (const bad of [
      { font: "url(https://tracker.test/font)" },
      { theme: "custom" },
      { css: "body{}" },
      { layout: "<script>" },
      { coverVersionIds: ["https://gallery.test/photo"] },
      { coverVersionIds: [id(), id(), id(), id()] },
    ]) {
      expect(galleryDesignSchema.safeParse(bad).success).toBe(false);
    }
    const repeated = id();
    expect(galleryDesignSchema.safeParse({ coverVersionIds: [repeated, repeated] }).success).toBe(
      false,
    );
  });
  test("only verified versions belonging to the gallery can be chosen", () => {
    const { state, v } = photo(draft());
    expect(() =>
      apply(state, { type: "presentation", presentation: presentation([id()]) }),
    ).toThrow("verified cover");
    const pending = structuredClone(state);
    pending.photos[0]!.versions[0]!.ready = false;
    expect(() =>
      apply(pending, { type: "presentation", presentation: presentation([v.id]) }),
    ).toThrow("verified cover");
    expect(state.presentation).toBeUndefined();
  });
  test("unpublished cover IDs and images never enter the client projection", () => {
    const first = photo(draft());
    const second = photo(first.state);
    let state = apply(second.state, {
      type: "presentation",
      presentation: presentation([first.v.id, second.v.id]),
    });
    state = apply(state, { type: "publish", versionIds: [first.v.id] });
    expect(galleryCovers(state, "owner").map((v) => v.id)).toEqual([first.v.id, second.v.id]);
    expect(galleryCovers(state, "client").map((v) => v.id)).toEqual([first.v.id]);
    const visible = clientState(state);
    expect(visible.presentation?.design?.coverVersionIds).toEqual([first.v.id]);
    expect(visible.photos.flatMap((p) => p.versions.map((v) => v.id))).not.toContain(second.v.id);
    expect(state.presentation?.design?.coverVersionIds).toHaveLength(2);
  });
  test("publishing a replacement never silently changes a selected cover", () => {
    const first = photo(draft());
    let state = apply(first.state, {
      type: "presentation",
      presentation: presentation([first.v.id]),
    });
    state = apply(state, { type: "publish", versionIds: [first.v.id] });
    const replacement = photo(state, first.v.photoId);
    state = apply(replacement.state, { type: "publish", versionIds: [replacement.v.id] });
    expect(galleryCovers(state, "client")).toEqual([]);
    expect(galleryCovers(state, "owner")[0]!.id).toBe(first.v.id);
    expect(clientState(state).presentation?.design?.coverVersionIds).toEqual([]);
    state = apply(state, { type: "presentation", presentation: presentation([replacement.v.id]) });
    expect(galleryCovers(state, "client")[0]!.id).toBe(replacement.v.id);
  });
  test("clients cannot redesign galleries and styling cannot approve, release or pick images", () => {
    const ready = photo(draft());
    const state = apply(ready.state, { type: "publish", versionIds: [ready.v.id] });
    const command = { type: "presentation" as const, presentation: presentation([ready.v.id]) };
    expect(() => apply(state, command, "client")).toThrow("photographer");
    const next = apply(state, command);
    for (const key of [
      "photos",
      "picks",
      "submissions",
      "approvals",
      "releases",
      "released",
    ] as const)
      expect(next[key]).toEqual(state[key]);
  });
  test("settings expose native controls and no new shell, tracking or store promises", () => {
    const ready = photo(draft());
    const html = renderToStaticMarkup(
      <GalleryPresentationForm
        state={ready.state}
        busy={false}
        save={async () => {}}
        onDirty={() => {}}
      />,
    );
    for (const label of [
      "Gallery font",
      "Gallery appearance",
      "Photo layout",
      "Photo spacing",
      "Cover photo 1",
      "Cover photo 2",
      "Cover photo 3",
      "Save presentation",
      "finish.jpg",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("Buy prints");
  });
});
