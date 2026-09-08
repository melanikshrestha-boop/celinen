import { describe, expect, test } from "bun:test";
import {
  acknowledgeCommentDraft,
  commentDraftScope,
  moveCommentDraft,
  readCommentDrafts,
  reconcileCommentDrafts,
  saveCommentDrafts,
  updateCommentDraft,
  type CommentDrafts,
} from "../src/lib/delivery/comment-drafts";
import type { DeliveryComment } from "../src/lib/delivery/workflow";

const id = () => crypto.randomUUID();
const version = id(),
  photo = id(),
  otherVersion = id(),
  otherPhoto = id();
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function note() {
  return updateCommentDraft({}, version, photo, {
    body: "  Warmer, please — 東京 📷  ",
    revision: true,
  });
}
function receipt(drafts: CommentDrafts): DeliveryComment {
  const draft = drafts[version]!;
  return {
    ...draft,
    id: draft.operationId,
    versionId: version,
    role: "client",
    body: draft.body.trim(),
    at: "2026-09-07T16:00:00.000Z",
    resolvedAt: null,
  };
}

describe("exact-version, tab-local delivery note recovery", () => {
  test("photo switching retains each note's separate text and change-request intent", () => {
    const first = note();
    const both = updateCommentDraft(first, otherVersion, otherPhoto, {
      body: "Keep the motion blur",
      revision: false,
    });
    expect(both[version]).toEqual(first[version]);
    expect(both[otherVersion]!.revision).toBe(false);
    expect(first[otherVersion]).toBeUndefined();
    const changed = updateCommentDraft(both, otherVersion, otherPhoto, { revision: true });
    expect(changed[version]).toEqual(first[version]);
    expect(changed[otherVersion]!.body).toBe("Keep the motion blur");
  });
  test("reload restores text, Unicode, intent and the exact retry operation ID", () => {
    const tab = storage(),
      scope = commentDraftScope(id(), id()),
      drafts = note();
    saveCommentDrafts(tab, scope, drafts);
    expect(readCommentDrafts(tab, scope)).toEqual(drafts);
    expect(updateCommentDraft(drafts, version, photo, { body: drafts[version]!.body })).toBe(
      drafts,
    );
  });
  test("gallery and invitation generation isolate drafts without storing an access token", () => {
    const tab = storage(),
      gallery = id(),
      generation = id(),
      scope = commentDraftScope(gallery, generation);
    saveCommentDrafts(tab, scope, note());
    expect(readCommentDrafts(tab, commentDraftScope(gallery, id()))).toEqual({});
    expect(readCommentDrafts(tab, commentDraftScope(id(), generation))).toEqual({});
    expect(readCommentDrafts(storage(), scope)).toEqual({});
    expect([...tab.values.keys()][0]).not.toContain("token");
  });
  test("a published edit does not silently retarget a note or inherit its receipt", () => {
    const before = note();
    expect(before[otherVersion]).toBeUndefined();
    const moved = moveCommentDraft(before, version, otherVersion, photo);
    expect(moved[otherVersion]!.body).toBe(before[version]!.body);
    expect(moved[otherVersion]!.revision).toBe(true);
    expect(moved[otherVersion]!.operationId).not.toBe(before[version]!.operationId);
    expect(moved[version]).toBeUndefined();
    expect(before[version]).toBeDefined();
  });
  test("moving never overwrites another unsent note or crosses photo identity", () => {
    const drafts = note();
    expect(() => moveCommentDraft(drafts, version, otherVersion, otherPhoto)).toThrow(
      "different photo",
    );
    expect(() => updateCommentDraft(drafts, version, otherPhoto, { body: "wrong" })).toThrow(
      "another photo",
    );
    const both = updateCommentDraft(drafts, otherVersion, photo, { body: "Another note" });
    expect(() => moveCommentDraft(both, version, otherVersion, photo)).toThrow("already");
    expect(both[version]).toEqual(drafts[version]);
  });
  test("late success does not clear an in-flight text or checkbox edit, even when text is unchanged", () => {
    const before = note(),
      op = before[version]!.operationId;
    const text = updateCommentDraft(before, version, photo, { body: "Actually, cooler" });
    const flag = updateCommentDraft(before, version, photo, { revision: false });
    expect(acknowledgeCommentDraft(text, version, op)).toBe(text);
    expect(acknowledgeCommentDraft(flag, version, op)).toBe(flag);
    expect(acknowledgeCommentDraft(before, version, op)).toEqual({});
  });
  test("lost-success reconciliation requires all exact receipt fields, not a matching phrase", () => {
    const drafts = note(),
      sent = receipt(drafts);
    for (const difference of [
      { id: id() },
      { versionId: otherVersion },
      { photoId: otherPhoto },
      { body: "Different" },
      { revision: false },
      { role: "owner" as const },
    ])
      expect(reconcileCommentDrafts(drafts, [{ ...sent, ...difference }], "client")).toBe(drafts);
    expect(reconcileCommentDrafts(drafts, [sent], "client")).toEqual({});
    expect(reconcileCommentDrafts(drafts, [sent], "owner")).toBe(drafts);
  });
  test("acknowledged notes are removed only from their own recovery slot", () => {
    const tab = storage(),
      scope = commentDraftScope(id(), id()),
      other = commentDraftScope(id(), id());
    saveCommentDrafts(tab, scope, note());
    saveCommentDrafts(tab, other, note());
    saveCommentDrafts(tab, scope, {});
    expect(readCommentDrafts(tab, scope)).toEqual({});
    expect(Object.keys(readCommentDrafts(tab, other))).toEqual([version]);
  });
  test("corrupt, oversized, duplicate and cross-scope caches fail without deleting saved data", () => {
    const tab = storage(),
      scope = commentDraftScope(id(), id());
    saveCommentDrafts(tab, scope, note());
    const key = [...tab.values.keys()][0]!,
      original = tab.values.get(key)!;
    const parsed = JSON.parse(original);
    for (const raw of [
      "{oops",
      "x".repeat(1024 * 1024 + 1),
      JSON.stringify({ ...parsed, scope: "wrong" }),
      JSON.stringify({ ...parsed, entries: [...parsed.entries, ...parsed.entries] }),
      JSON.stringify({ ...parsed, entries: [{ versionId: "__proto__", draft: note()[version] }] }),
      JSON.stringify({
        ...parsed,
        entries: [{ ...parsed.entries[0], draft: { ...note()[version], revision: "true" } }],
      }),
    ]) {
      tab.setItem(key, raw);
      expect(() => readCommentDrafts(tab, scope)).toThrow();
      expect(tab.getItem(key)).toBe(raw);
    }
    expect({}.toString).toBe(Object.prototype.toString);
  });
  test("quota/unavailable storage failures never clear or mutate the in-memory draft", () => {
    const drafts = note(),
      before = structuredClone(drafts);
    const denied = {
      ...storage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveCommentDrafts(denied, commentDraftScope(id(), id()), drafts)).toThrow("Quota");
    expect(drafts).toEqual(before);
    expect(() => updateCommentDraft(drafts, version, photo, { body: "x".repeat(4001) })).toThrow();
    expect(drafts).toEqual(before);
  });
  test("recovery limit refuses truncation and keeps the previous complete cache", () => {
    const tab = storage(),
      scope = commentDraftScope(id(), id()),
      original = note();
    saveCommentDrafts(tab, scope, original);
    let many = original;
    for (let i = 0; i < 128; i++) many = updateCommentDraft(many, id(), id(), { body: "Keep" });
    expect(() => saveCommentDrafts(tab, scope, many)).toThrow();
    expect(readCommentDrafts(tab, scope)).toEqual(original);
    expect(Object.keys(many)).toHaveLength(129);
  });
});
