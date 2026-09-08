import { describe, expect, test } from "bun:test";
import {
  clientState,
  commandSchema,
  downloadable,
  findVersion,
  isApproved,
  newDelivery,
  nextAction,
  objectPath,
  selectionsLocked,
  transition,
  versionInput,
  type Actor,
  type DeliveryCommand,
  type DeliveryState,
  type VersionInput,
} from "../src/lib/delivery/workflow";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";

const uuid = () => crypto.randomUUID();
const time = "2026-09-04T12:00:00.000Z";
const later = "2026-09-04T12:00:01.000Z";
function draft() {
  return newDelivery(
    {
      id: uuid(),
      title: "Friday night",
      clientName: "United",
      message: "Choose your favourites",
      selectionLimit: 2,
      expiresAt: "2026-10-04T12:00:00.000Z",
    },
    time,
  );
}
function version(photoId = uuid()): VersionInput {
  const r = { sha256: "a".repeat(64), bytes: 500, width: 1200, height: 800 };
  return {
    id: uuid(),
    photoId,
    filename: "goal.jpg",
    source: {
      projectId: uuid(),
      frameId: "frame:1",
      editVersionId: "edit:1",
      originalSha256: "b".repeat(64),
    },
    variants: { proof: { ...r }, phone: { ...r }, full: { ...r, width: 4800, height: 3200 } },
  };
}
function apply(
  s: DeliveryState,
  c: DeliveryCommand | { type: "complete"; versionId: string },
  actor: Actor = "owner",
  at = time,
) {
  return transition(s, c, actor, uuid(), JSON.stringify(c), at);
}
function ready(s = draft(), v = version()) {
  s = apply(s, { type: "reserve", version: v });
  return { state: apply(s, { type: "complete", versionId: v.id }), v };
}
function live() {
  const r = ready();
  return { ...r, state: apply(r.state, { type: "publish", versionIds: [r.v.id] }) };
}
function submitted() {
  const r = live();
  let state = apply(r.state, { type: "pick", photoId: r.v.photoId, on: true }, "client");
  state = apply(state, { type: "submit", photoIds: [r.v.photoId] }, "client");
  return { ...r, state };
}
function released() {
  const r = submitted();
  let state = apply(r.state, { type: "approve", versionId: r.v.id }, "client");
  state = apply(state, { type: "release", versionIds: [r.v.id] });
  return { ...r, state };
}

describe("proof-to-final delivery state machine", () => {
  test("drafts are private and no initial action fabricates approval or delivery", () => {
    const s = draft();
    expect(s.status).toBe("draft");
    expect(s.approvals).toEqual([]);
    expect(s.released).toEqual([]);
    expect(s.submissions).toEqual([]);
    expect(nextAction(s, "owner", time)).toContain("publish");
  });
  test("upload, publish, pick, submit, approve, release are separate gates", () => {
    const { state: s, v } = live();
    expect(isApproved(s, v.id)).toBe(false);
    expect(downloadable(s, v.id, time)).toBe(false);
    const picked = apply(s, { type: "pick", photoId: v.photoId, on: true }, "client");
    expect(() => apply(picked, { type: "approve", versionId: v.id }, "client")).toThrow("Submit");
    const submit = apply(picked, { type: "submit", photoIds: [v.photoId] }, "client");
    expect(submit.submissions[0]!.items).toEqual([{ photoId: v.photoId, versionId: v.id }]);
    expect(() => apply(submit, { type: "release", versionIds: [v.id] })).toThrow("approved");
    const approved = apply(submit, { type: "approve", versionId: v.id }, "client");
    expect(downloadable(approved, v.id, time)).toBe(false);
    const final = apply(approved, { type: "release", versionIds: [v.id] });
    expect(downloadable(final, v.id, time)).toBe(true);
    expect(nextAction(final, "client", time)).toContain("download");
  });
  test("new edits never inherit approval and do not expose themselves before publication", () => {
    const { state: old, v } = released(),
      newer = version(v.photoId);
    const uploaded = ready(old, newer).state;
    expect(downloadable(uploaded, v.id, time)).toBe(true);
    expect(clientState(uploaded).photos[0]!.versions.map((v) => v.id)).toEqual([v.id]);
    const published = apply(uploaded, { type: "publish", versionIds: [newer.id] });
    expect(downloadable(published, v.id, time)).toBe(false);
    expect(isApproved(published, newer.id)).toBe(false);
    expect(published.releases[0]!.versionIds).toEqual([v.id]);
    expect(published.submissions[0]!.items[0]!.versionId).toBe(v.id);
    expect(old.photos[0]!.versions).toHaveLength(1);
  });
  test("late retry completion cannot replace a newer verified version", () => {
    for (const reverse of [false, true]) {
      const one = version(),
        two = version(one.photoId);
      let state = apply(draft(), { type: "reserve", version: one });
      state = apply(state, { type: "reserve", version: two });
      for (const v of reverse ? [two, one] : [one, two])
        state = apply(state, { type: "complete", versionId: v.id });
      expect(state.photos[0]!.current).toBe(two.id);
      expect(state.photos[0]!.versions.map((v) => v.number)).toEqual([1, 2]);
    }
  });
  test("plain comments do not invalidate approval; explicit changes do", () => {
    const { state: s, v } = released();
    const note = apply(
      s,
      { type: "comment", versionId: v.id, body: "Love it!", revision: false },
      "client",
    );
    expect(downloadable(note, v.id, time)).toBe(true);
    const request = apply(
      note,
      { type: "comment", versionId: v.id, body: "Warm it up a little", revision: true },
      "client",
    );
    expect(downloadable(request, v.id, time)).toBe(false);
    expect(request.approvals).toHaveLength(1);
    expect(request.approvals[0]!.revokedAt).toBe(time);
    expect(() => apply(request, { type: "approve", versionId: v.id }, "client")).toThrow("address");
    const addressed = apply(request, { type: "resolve", commentId: request.comments.at(-1)!.id });
    expect(isApproved(addressed, v.id)).toBe(false);
    const approved = apply(addressed, { type: "approve", versionId: v.id }, "client");
    expect(isApproved(approved, v.id)).toBe(true);
    expect(downloadable(approved, v.id, time)).toBe(false);
  });
  test("selection submission is immutable until explicitly reopened, even at equal timestamps", () => {
    const { state, v } = submitted();
    expect(selectionsLocked(state)).toBe(true);
    expect(() => apply(state, { type: "pick", photoId: v.photoId, on: false }, "client")).toThrow(
      "submitted",
    );
    expect(() => apply(state, { type: "submit", photoIds: [v.photoId] }, "client")).toThrow(
      "already",
    );
    const reopened = apply(state, { type: "reopenSelections" });
    expect(selectionsLocked(reopened)).toBe(false);
    const second = apply(reopened, { type: "submit", photoIds: [v.photoId] }, "client");
    expect(selectionsLocked(second)).toBe(true);
    expect(second.submissions).toHaveLength(2);
  });
  test("reopening preserves historical approvals and releases but disables their access", () => {
    const { state, v } = released();
    const next = apply(state, { type: "reopenSelections" });
    expect(next.releases).toHaveLength(1);
    expect(next.approvals).toHaveLength(1);
    expect(downloadable(next, v.id, time)).toBe(false);
  });
  test("selection snapshots reject stale, duplicate, excessive and foreign photo IDs", () => {
    const { state, v } = live();
    const picked = apply(state, { type: "pick", photoId: v.photoId, on: true }, "client");
    expect(() => apply(picked, { type: "submit", photoIds: [uuid()] }, "client")).toThrow(
      "changed",
    );
    expect(() =>
      apply(picked, { type: "submit", photoIds: [v.photoId, v.photoId] }, "client"),
    ).toThrow("count");
    expect(() => apply(picked, { type: "pick", photoId: uuid(), on: true }, "client")).toThrow(
      "published",
    );
  });
  test("draft and expired clients cannot mutate even existing ready media", () => {
    const { state, v } = ready();
    expect(() => apply(state, { type: "pick", photoId: v.photoId, on: true }, "client")).toThrow(
      "unavailable",
    );
    const r = released();
    const expired = "2026-10-04T12:00:00.000Z";
    expect(downloadable(r.state, r.v.id, expired)).toBe(false);
    expect(() =>
      apply(
        r.state,
        { type: "comment", versionId: r.v.id, body: "late", revision: false },
        "client",
        expired,
      ),
    ).toThrow("unavailable");
  });
  test("invalid transitions never mutate the input or its prior audit", () => {
    const { state, v } = submitted();
    const before = JSON.stringify(state);
    expect(() => apply(state, { type: "release", versionIds: [v.id] })).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });
  test("request replay is idempotent and changed payload reuse is rejected", () => {
    const { state, v } = live();
    const id = uuid();
    const cmd: DeliveryCommand = {
      type: "comment",
      versionId: v.id,
      body: "Please crop left",
      revision: true,
    };
    const next = transition(state, cmd, "client", id, "a", time);
    expect(transition(next, cmd, "client", id, "a", later)).toBe(next);
    expect(() => transition(next, cmd, "client", id, "b", later)).toThrow("different request");
    expect(next.comments).toHaveLength(1);
  });
  test("browser handoff receipts are client-only, idempotent, and never claim a completed save", () => {
    const { state, v } = released();
    const operation = uuid();
    const command = commandSchema.parse({
      type: "downloadHandoff",
      versionIds: [v.id],
      kind: "full",
      container: "file",
    });
    expect(() => transition(state, command, "owner", operation, "same", time)).toThrow("client");
    const recorded = transition(state, command, "client", operation, "same", time);
    expect(recorded.events.at(-1)?.text).toBe(
      "Browser handoff recorded: 1 high-resolution copy; final save location not verified",
    );
    expect(recorded.events.at(-1)?.text.toLowerCase()).not.toContain("download completed");
    expect(transition(recorded, command, "client", operation, "same", later)).toBe(recorded);
    expect(() => transition(recorded, command, "client", operation, "different", later)).toThrow(
      "different request",
    );
  });
  test("browser handoff receipts reject stale access, unreleased versions, duplicates, and invalid file batches", () => {
    const { state, v } = released();
    expect(() =>
      apply(
        state,
        {
          type: "downloadHandoff",
          versionIds: [v.id, v.id],
          kind: "phone",
          container: "zip",
        },
        "client",
      ),
    ).toThrow("Duplicate");
    expect(() =>
      apply(
        state,
        {
          type: "downloadHandoff",
          versionIds: [v.id, uuid()],
          kind: "phone",
          container: "file",
        },
        "client",
      ),
    ).toThrow("exactly one file");
    const reopened = apply(state, { type: "reopenSelections" });
    expect(() =>
      apply(
        reopened,
        { type: "downloadHandoff", versionIds: [v.id], kind: "phone", container: "file" },
        "client",
      ),
    ).toThrow("released finals");
    expect(() =>
      apply(
        state,
        { type: "downloadHandoff", versionIds: [v.id], kind: "phone", container: "file" },
        "client",
        "2026-10-04T12:00:00.000Z",
      ),
    ).toThrow("unavailable");
  });
  test("foreign versions and ambiguous publish/release lists fail", () => {
    const { state, v } = released();
    expect(() => findVersion(state, uuid())).toThrow("not found");
    expect(() => apply(state, { type: "publish", versionIds: [v.id, v.id] })).toThrow(
      "one current",
    );
    expect(() => apply(state, { type: "release", versionIds: [v.id, v.id] })).toThrow("Duplicate");
    const pending = version(v.photoId),
      p = apply(state, { type: "reserve", version: pending });
    expect(() => apply(p, { type: "publish", versionIds: [pending.id] })).toThrow("verified");
  });
  test("client DTO excludes source references, receipts, unpublished comments and unreleased file hashes", () => {
    const { state, v } = live();
    const draftV = version(v.photoId);
    const pending = ready(state, draftV).state;
    const secret = apply(pending, {
      type: "comment",
      versionId: draftV.id,
      body: "PRIVATE EDIT NOTES",
      revision: false,
    });
    const dto = clientState(secret),
      serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("PRIVATE EDIT NOTES");
    expect(serialized).not.toContain(draftV.id);
    expect(serialized).not.toContain(v.source!.originalSha256);
    expect(dto.receipts).toEqual([]);
    expect(dto.photos[0]!.versions[0]!.variants.full.sha256).toBe("");
  });
  test("formerly published comments remain visible after revisions; draft comments remain hidden", () => {
    const { state, v } = live();
    const comment = apply(
      state,
      { type: "comment", versionId: v.id, body: "Old request", revision: true },
      "client",
    );
    const newer = version(v.photoId);
    const next = apply(ready(comment, newer).state, { type: "publish", versionIds: [newer.id] });
    expect(clientState(next).comments[0]!.body).toBe("Old request");
    expect(nextAction(next, "client", time)).toContain("Choose");
  });
  test("close/reopen handles expiry without deleting prior work", () => {
    const { state, v } = released(),
      closed = apply(state, { type: "close" });
    expect(downloadable(closed, v.id, time)).toBe(false);
    expect(closed.photos).toEqual(state.photos);
    expect(() => apply(closed, { type: "reopen", expiresAt: time })).toThrow("expiry");
    expect(() =>
      apply(closed, { type: "reopen", expiresAt: "2029-01-01T00:00:00.000Z" }),
    ).toThrow();
  });
  for (const type of [
    "reserve",
    "publish",
    "close",
    "reopen",
    "reopenSelections",
    "resolve",
    "release",
  ] as const)
    test(`clients cannot issue owner command ${type}`, () => {
      const { state, v } = released();
      const commands = {
        reserve: { type, version: version() },
        publish: { type, versionIds: [v.id] },
        close: { type },
        reopen: { type, expiresAt: later },
        reopenSelections: { type },
        resolve: { type, commentId: uuid() },
        release: { type, versionIds: [v.id] },
      };
      expect(() => apply(state, commands[type] as DeliveryCommand, "client")).toThrow(
        "photographer",
      );
    });
  for (const type of ["pick", "submit", "approve", "downloadHandoff"] as const)
    test(`photographers cannot impersonate client ${type}`, () => {
      const { state, v } = live();
      const commands = {
        pick: { type, photoId: v.photoId, on: true },
        submit: { type, photoIds: [v.photoId] },
        approve: { type, versionId: v.id },
        downloadHandoff: {
          type,
          versionIds: [v.id],
          kind: "phone",
          container: "file",
        },
      };
      expect(() => apply(state, commands[type] as DeliveryCommand)).toThrow("client");
    });
});
describe("delivery input and object boundaries", () => {
  test("strict schema rejects injected storage paths, roles and internal completion commands", () => {
    expect(commandSchema.safeParse({ type: "complete", versionId: uuid() }).success).toBe(false);
    expect(
      commandSchema.safeParse({
        type: "comment",
        versionId: uuid(),
        body: "hello",
        revision: false,
        role: "owner",
      }).success,
    ).toBe(false);
    expect(
      versionInput.safeParse({ ...version(), storagePath: "another-owner/final.jpg" }).success,
    ).toBe(false);
  });
  for (const filename of ["../secret.jpg", "dir\\file.jpg", "bad\n.jpg", ""])
    test(`rejects unsafe filename ${JSON.stringify(filename)}`, () =>
      expect(versionInput.safeParse({ ...version(), filename }).success).toBe(false));
  for (const value of [0, -1, Infinity, NaN, 31 * 1024 * 1024])
    test(`rejects invalid byte size ${value}`, () => {
      const v = version();
      v.variants.full.bytes = value;
      expect(versionInput.safeParse(v).success).toBe(false);
    });
  test("proof and phone edge limits are checked independently", () => {
    const v = version();
    v.variants.proof.width = 1601;
    expect(versionInput.safeParse(v).success).toBe(false);
    v.variants.proof.width = 1600;
    v.variants.phone.height = 2049;
    expect(versionInput.safeParse(v).success).toBe(false);
  });
  test("object paths derive exclusively from validated tenant/gallery/version/hash", () => {
    const owner = uuid(),
      gallery = uuid(),
      v = version();
    expect(objectPath(owner, gallery, v, "full")).toBe(
      `${owner}/${gallery}/${v.id}/full-${v.variants.full.sha256}.jpg`,
    );
    expect(() => objectPath("../other", gallery, v, "full")).toThrow();
    expect(objectPath(owner, gallery, v, "proof")).not.toBe(objectPath(owner, gallery, v, "full"));
  });
  test("bounded plain comments accept creative language but reject empty/oversize input", () => {
    expect(
      commandSchema.safeParse({ type: "comment", versionId: uuid(), body: "   ", revision: false })
        .success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        type: "comment",
        versionId: uuid(),
        body: "x".repeat(4001),
        revision: false,
      }).success,
    ).toBe(false);
    expect(
      commandSchema.parse({
        type: "comment",
        versionId: uuid(),
        body: "Make it warmer <script>alert(1)</script>",
        revision: true,
      }).type,
    ).toBe("comment"); // Rendered as React text, never interpreted/executed.
  });
  test("JPEG metadata rejects non-image, truncated and malformed marker data", () => {
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array([0xff, 0xd8]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 0]),
    ])
      expect(() => jpegDimensions(bytes)).toThrow();
  });
  test("reads dimensions of real public-domain fixture without decoding pixels", async () => {
    const bytes = new Uint8Array(
      await Bun.file(
        new URL("./fixtures/photos/basketball-action-usaf-pd.jpg", import.meta.url),
      ).arrayBuffer(),
    );
    const dimensions = jpegDimensions(bytes);
    expect(dimensions.width).toBeGreaterThan(1);
    expect(dimensions.height).toBeGreaterThan(1);
  });
  test("3,000-photo selection metadata stays coherent and does not mutate the shoot", () => {
    const s = draft();
    s.status = "live";
    s.selectionLimit = 3000;
    for (let i = 0; i < 3000; i++) {
      const v = version();
      s.photos.push({
        id: v.photoId,
        current: v.id,
        published: v.id,
        versions: [{ ...v, ready: true, createdAt: time, number: 1, publishedAt: time }],
      });
      s.picks.push(v.photoId);
    }
    const before = JSON.stringify(s),
      start = performance.now();
    const next = apply(s, { type: "submit", photoIds: [...s.picks] }, "client");
    expect(next.submissions[0]!.items).toHaveLength(3000);
    expect(JSON.stringify(s)).toBe(before);
    expect(clientState(next).photos).toHaveLength(3000);
    console.info(
      `Delivery metadata backtest: 3,000 selections submitted and projected in ${(performance.now() - start).toFixed(1)} ms (no network/media benchmark).`,
    );
  });
});
