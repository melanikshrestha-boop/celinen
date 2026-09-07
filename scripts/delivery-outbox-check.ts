// Run separately from the main suite: mocks never enter other tests or the real app.
// bun scripts/delivery-outbox-check.ts /absolute/temp/runtime-with-fake-indexeddb
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const runtime = process.argv[2];
if (!runtime?.startsWith("/")) throw new Error("Pass an absolute isolated test-runtime directory.");
await import(pathToFileURL(resolve(runtime, "node_modules/fake-indexeddb/auto/index.mjs")).href);
const owner = crypto.randomUUID(),
  other = crypto.randomUUID();
let currentOwner: string | null = owner;
let remoteReads = 0,
  remoteWrites = 0;
const readHook: { beforeRead?: () => void } = {};
let creationOwner: string | null = null;
let createdPresentation: unknown;
let failCreation = false;
mock.module("../src/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: currentOwner ? { user: { id: currentOwner } } : null },
      }),
    },
  },
}));
mock.module("../src/lib/delivery/remote.functions", () => ({
  createPrivateDelivery: async ({
    data,
  }: {
    data: { id: string; ownerId: string; presentation?: unknown };
  }) => {
    remoteWrites++;
    creationOwner = data.ownerId;
    assert.equal(data.ownerId, currentOwner);
    createdPresentation = data.presentation;
    if (failCreation) throw new Error("Network unavailable");
    return { id: data.id, revision: 0, state: { photos: [] } };
  },
  getPrivateDelivery: async () => {
    remoteReads++;
    readHook.beforeRead?.();
    return { state: { photos: [] } };
  },
  changePrivateDelivery: async () => {
    remoteWrites++;
    throw new Error("Unexpected remote mutation");
  },
  getPrivateUploadTickets: async () => {
    remoteWrites++;
    throw new Error("Unexpected ticket request");
  },
  verifyPrivateUpload: async () => {
    remoteWrites++;
    throw new Error("Unexpected verification");
  },
}));
const {
  createDraft,
  saveDraft,
  saveDraftPresentation,
  saveJob,
  listDrafts,
  listUploadJobs,
  connectDraft,
  uploadJob,
} = await import("../src/lib/delivery/outbox");
import type { UploadJob } from "../src/lib/delivery/outbox";
const input = () => ({
  id: crypto.randomUUID(),
  title: "Isolated test",
  clientName: "No client",
  message: "",
  selectionLimit: 1,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
});
const local = await createDraft(input(), null);
const baseline = { studioName: "", showLensLabsCredit: true };
const presentation = { studioName: "Céline Nova", showLensLabsCredit: false };
await saveDraftPresentation(local.id, null, baseline, presentation);
await assert.rejects(
  saveDraftPresentation(local.id, null, baseline, { ...presentation, studioName: "Stale" }),
  /another tab/,
);
await assert.rejects(
  saveDraftPresentation(local.id, other, presentation, baseline),
  /another account/,
);
await saveDraft(local); // Old preparation snapshot must not erase presentation.
assert.deepEqual((await listDrafts(null))[0]!.state.presentation, presentation);
const blob = new Blob(["fixture"], { type: "image/jpeg" });
const media = { bytes: blob.size, sha256: "a".repeat(64), width: 1, height: 1 };
const job = (galleryId: string, ownerId: string | null): UploadJob => {
  const id = crypto.randomUUID();
  return {
    id,
    galleryId,
    ownerId,
    version: {
      id,
      photoId: crypto.randomUUID(),
      filename: "fixture.jpg",
      source: null,
      variants: { proof: media, phone: media, full: media },
    },
    files: { proof: blob, phone: blob, full: blob },
    uploaded: [],
    status: "queued",
    error: null,
    operationId: crypto.randomUUID(),
    preparedAt: Date.now(),
  };
};
const existing = job(local.id, null);
await saveJob(existing);
const late = job(local.id, null); // Simulates rendering begun before another tab's Connect.
await connectDraft(local, owner, () => {});
assert.deepEqual(createdPresentation, presentation); // Connect uses the atomic current draft, not stale caller state.
assert.equal(creationOwner, owner);
assert.equal((await listDrafts(owner)).length, 1);
assert.equal((await listDrafts(other)).length, 0);
assert.equal((await listUploadJobs(local.id, owner))[0]!.ownerId, owner);
assert.equal((await listUploadJobs(local.id, other)).length, 0);
await assert.rejects(saveJob(late));
assert.equal((await listUploadJobs(local.id, owner)).length, 1);
await assert.rejects(saveJob({ ...existing, error: "stale tab" }));
assert.equal((await listUploadJobs(local.id, owner))[0]!.error, null);
const owned = (await listUploadJobs(local.id, owner))[0]!;
const writes = remoteWrites;
readHook.beforeRead = () => {
  currentOwner = other;
};
await assert.rejects(
  uploadJob(
    owned,
    () => {},
    () => {},
  ),
  /Account changed/,
);
assert.equal(remoteReads, 1);
assert.equal(remoteWrites, writes);
assert.equal((await listUploadJobs(local.id, owner))[0]!.files.proof.size, blob.size);
currentOwner = owner;
await assert.rejects(
  uploadJob(
    owned,
    () => {},
    () => {
      throw new Error("Old identity generation");
    },
  ),
  /Old identity/,
);
assert.equal(remoteReads, 1);
assert.equal((await listDrafts(null)).length, 0);
const racing = await createDraft(input(), owner);
const outcomes = await Promise.allSettled([
  saveDraftPresentation(racing.id, owner, baseline, presentation),
  saveDraftPresentation(racing.id, owner, baseline, { ...presentation, studioName: "Other tab" }),
]);
assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
const interrupted = await createDraft(input(), owner);
failCreation = true;
await assert.rejects(
  connectDraft(interrupted, owner, () => {}),
  /Network/,
);
await assert.rejects(
  saveDraftPresentation(interrupted.id, owner, baseline, presentation),
  /retry Connect & upload/,
);
failCreation = false;
await connectDraft(interrupted, owner, () => {});
assert.equal((await listDrafts(owner)).find((d) => d.id === interrupted.id)!.synced, true);
console.log(
  "Delivery outbox QA passed: ownership, draft presentation, concurrent saves, stale preparation, connecting snapshots, interrupted connection retry, claim-races and account changes; no real storage or network used.",
);
