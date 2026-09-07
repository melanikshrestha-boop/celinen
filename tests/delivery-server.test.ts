import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  act,
  completeUpload,
  createRoom,
  credentialMatches,
  deliveryReadiness,
  openRoom,
  rotateInvitation,
  signedMedia,
  uploadTickets,
  type Room,
} from "../src/lib/delivery/remote.server";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";
import {
  objectPath,
  variantNames,
  type DeliveryCommand,
  type VersionInput,
} from "../src/lib/delivery/workflow";

const uid = () => crypto.randomUUID();
const owner = uid(),
  other = uid();
const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env["SUPABASE_URL"],
  key: process.env["SUPABASE_SERVICE_ROLE_KEY"],
  origin: process.env["DELIVERY_PUBLIC_ORIGIN"],
};
let rows: Map<string, Room>;
let objects: Map<string, Uint8Array>;
let bucketPublic: boolean;
let bucketLimit: number | null;
let calls: string[];
let conflictOnce: boolean;
let allowed: boolean;
let approved: boolean;
let quotaAvailable: boolean;
let verificationAvailable: boolean;
let storageInfoError: string | null;
let closedOperations: Set<string>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  process.env["SUPABASE_URL"] = "https://delivery-test.invalid";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-server-only-key";
  process.env["DELIVERY_PUBLIC_ORIGIN"] = "https://gallery.example.test";
  rows = new Map();
  objects = new Map();
  calls = [];
  bucketPublic = false;
  bucketLimit = 31457280;
  conflictOnce = false;
  allowed = true;
  approved = quotaAvailable = verificationAvailable = true;
  storageInfoError = null;
  closedOperations = new Set();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init),
      url = new URL(request.url),
      path = url.pathname;
    if (url.hostname !== "delivery-test.invalid")
      throw new Error("Network is forbidden in delivery server tests.");
    calls.push(`${request.method} ${path}`);
    if (path === "/storage/v1/bucket/delivery-private-v1")
      return json({
        id: "delivery-private-v1",
        public: bucketPublic,
        file_size_limit: bucketLimit,
        allowed_mime_types: ["image/jpeg"],
      });
    if (path === "/rest/v1/rpc/delivery_take_request") return json(allowed);
    if (path === "/rest/v1/delivery_owner_limits")
      return json(url.searchParams.get("limit") === "0" ? [] : [{ enabled: approved }]);
    if (path === "/rest/v1/delivery_verification_slots") return json([]);
    if (path === "/rest/v1/rpc/delivery_reserve_upload") return json(quotaAvailable);
    if (path === "/rest/v1/rpc/delivery_acquire_verification") return json(verificationAvailable);
    if (path === "/rest/v1/rpc/delivery_release_verification") return json(null);
    if (path === "/rest/v1/rpc/delivery_settle_upload") return json(true);
    if (path === "/rest/v1/rpc/delivery_commit_verified") {
      const body = await request.json(),
        row = rows.get(body.p_gallery);
      if (!row || row.owner_id !== body.p_owner || row.revision !== body.p_revision)
        return json([]);
      row.state = body.p_state;
      row.revision++;
      return json([row]);
    }
    if (path === "/rest/v1/rpc/delivery_close_room") {
      const body = await request.json(),
        row = rows.get(body.p_gallery);
      if (!row || row.owner_id !== body.p_owner) return json({ message: "account" }, 403);
      if (!closedOperations.has(body.p_operation)) {
        if (row.revision !== body.p_revision) return json({ message: "conflict" }, 409);
        row.state.status = "closed";
        row.invitation_hash = null;
        row.revision++;
        closedOperations.add(body.p_operation);
      }
      return json([row]);
    }
    if (path === "/rest/v1/delivery_rooms") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      if (request.method === "POST") {
        const body = await request.json();
        const row = { ...body, revision: 0, invitation_hash: null };
        rows.set(body.id, structuredClone(row));
        return json(row);
      }
      if (request.method === "PATCH") {
        const current = id && rows.get(id),
          revision = Number(url.searchParams.get("revision")?.replace(/^eq\./, ""));
        if (conflictOnce && current) {
          current.revision++;
          conflictOnce = false;
        }
        if (!current || current.revision !== revision) return json([]);
        const updated = { ...current, ...(await request.json()) };
        rows.set(current.id, structuredClone(updated));
        return json([updated]);
      }
      let result = id ? (rows.has(id) ? [rows.get(id)!] : []) : [...rows.values()];
      if (url.searchParams.has("owner_id"))
        result = result.filter(
          (row) => row.owner_id === url.searchParams.get("owner_id")!.slice(3),
        );
      if (url.searchParams.get("limit") === "0") result = [];
      const select = url.searchParams.get("select");
      const projected =
        select === "invitation_hash"
          ? result.map((r) => ({ invitation_hash: r.invitation_hash }))
          : result;
      return json(
        request.headers.get("Accept")?.includes("vnd.pgrst.object")
          ? (projected[0] ?? null)
          : projected,
      );
    }
    if (path === "/storage/v1/object/sign/delivery-private-v1") {
      const body = await request.json();
      return json(
        body.paths.map((p: string) => ({
          path: p,
          signedURL: `/object/sign/delivery-private-v1/${p}?token=short-lived-test`,
        })),
      );
    }
    if (path.startsWith("/storage/v1/object/upload/sign/delivery-private-v1/"))
      return json({ url: `${path}?token=upload-test` });
    const infoPrefix = "/storage/v1/object/info/delivery-private-v1/";
    if (path.startsWith(infoPrefix)) {
      if (storageInfoError) return json({ code: storageInfoError, message: storageInfoError }, 403);
      const bytes = objects.get(decodeURIComponent(path.slice(infoPrefix.length)));
      return bytes
        ? json({ size: bytes.byteLength, content_type: "image/jpeg" })
        : json({ code: "NoSuchKey", message: "Object not found" }, 404);
    }
    const objectPrefix = "/storage/v1/object/delivery-private-v1/";
    if (path.startsWith(objectPrefix)) {
      const bytes = objects.get(decodeURIComponent(path.slice(objectPrefix.length)));
      return bytes
        ? new Response(bytes, { headers: { "Content-Type": "image/jpeg" } })
        : json({ message: "Object not found" }, 404);
    }
    throw new Error(`Unmocked delivery endpoint: ${request.method} ${path}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [
    ["SUPABASE_URL", originalEnv.url],
    ["SUPABASE_SERVICE_ROLE_KEY", originalEnv.key],
    ["DELIVERY_PUBLIC_ORIGIN", originalEnv.origin],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function room() {
  return createRoom(owner, {
    id: uid(),
    title: "United",
    clientName: "The team",
    message: "Choose",
    selectionLimit: 20,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
}
async function photo(id: string) {
  const bytes = new Uint8Array(
    await Bun.file(
      new URL("./fixtures/delivery/delivery-proof-usaf-pd.jpg", import.meta.url),
    ).arrayBuffer(),
  );
  const dims = jpegDimensions(bytes),
    media = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      ...dims,
    };
  const v: VersionInput = {
    id: uid(),
    photoId: uid(),
    filename: "test.jpg",
    source: null,
    variants: { proof: media, phone: media, full: media },
  };
  await act(id, owner, "", rows.get(id)!.revision, v.id, { type: "reserve", version: v });
  for (const kind of variantNames) objects.set(objectPath(owner, id, v, kind), bytes);
  return v;
}
async function ownerAct(id: string, command: DeliveryCommand) {
  return act(id, owner, "", rows.get(id)!.revision, uid(), command);
}
async function liveRoom() {
  const r = await room(),
    v = await photo(r.id);
  await completeUpload(r.id, owner, v.id);
  await ownerAct(r.id, { type: "publish", versionIds: [v.id] });
  const invite = await rotateInvitation(r.id, owner, rows.get(r.id)!.revision);
  return { id: r.id, v, token: new URL(invite.url).hash.slice(1) };
}
async function clientAct(id: string, token: string, command: DeliveryCommand) {
  return act(id, null, token, rows.get(id)!.revision, uid(), command);
}

describe("private delivery server boundaries with an isolated fake Supabase transport", () => {
  test("readiness fails closed without a server secret or with a public bucket", async () => {
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    expect((await deliveryReadiness()).ready).toBe(false);
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-key";
    bucketPublic = true;
    expect((await deliveryReadiness()).ready).toBe(false);
    bucketPublic = false;
    expect((await deliveryReadiness()).ready).toBe(true);
  });
  test("wrong-owner access cannot read, mutate, sign or reserve uploads", async () => {
    const r = await room(),
      v = await photo(r.id);
    await expect(openRoom(r.id, other, "")).rejects.toThrow("unavailable");
    await expect(act(r.id, other, "", 0, uid(), { type: "close" })).rejects.toThrow("close");
    await expect(uploadTickets(r.id, other, v.id)).rejects.toThrow("unavailable");
    await expect(signedMedia(r.id, other, "", [v.id], "proof")).rejects.toThrow("unavailable");
  });
  test("creation retry preserves exact settings; changed payload reuse is rejected", async () => {
    const input = {
      id: uid(),
      title: "One",
      clientName: "Client",
      message: "Hello",
      selectionLimit: 2,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const r = await createRoom(owner, input);
    expect((await createRoom(owner, input)).id).toBe(r.id);
    for (const patch of [
      { message: "Different" },
      { selectionLimit: 3 },
      { expiresAt: new Date(Date.now() + 172800000).toISOString() },
    ])
      await expect(createRoom(owner, { ...input, ...patch })).rejects.toThrow("different details");
  });
  test("completion verifies bytes and does not collide with reservation operation ID", async () => {
    const r = await room(),
      v = await photo(r.id); // Deliberately uses operationId == versionId.
    const done = await completeUpload(r.id, owner, v.id);
    expect(done.state.photos[0]!.versions[0]!.ready).toBe(true);
    const repeat = await completeUpload(r.id, owner, v.id);
    expect(repeat.revision).toBe(done.revision);
  });
  test("missing, truncated or corrupted rendition cannot become a verified upload", async () => {
    const r = await room(),
      v = await photo(r.id),
      path = objectPath(owner, r.id, v, "full"),
      bytes = objects.get(path)!;
    objects.delete(path);
    await expect(completeUpload(r.id, owner, v.id)).rejects.toThrow("incomplete");
    objects.set(path, bytes.slice(0, -1));
    await expect(completeUpload(r.id, owner, v.id)).rejects.toThrow("size");
    const corrupt = bytes.slice();
    corrupt[100] = corrupt[100]! ^ 1;
    objects.set(path, corrupt);
    await expect(completeUpload(r.id, owner, v.id)).rejects.toThrow("checksum");
    expect(rows.get(r.id)!.state.photos[0]!.versions[0]!.ready).toBe(false);
  });
  test("private-bucket enforcement is on actual operations, not just readiness UI", async () => {
    const r = await liveRoom();
    bucketPublic = true;
    await expect(openRoom(r.id, null, r.token)).rejects.toThrow("Private media");
    await expect(uploadTickets(r.id, owner, r.v.id)).rejects.toThrow("Private media");
    await expect(completeUpload(r.id, owner, r.v.id)).rejects.toThrow("Private media");
    await expect(signedMedia(r.id, owner, "", [r.v.id], "proof")).rejects.toThrow("Private media");
    expect(calls.some((p) => p.startsWith("POST /storage/v1/object/sign/"))).toBe(false);
  });
  test("wrong, cross-gallery, rotated, closed and expired invitations cannot read or write", async () => {
    const r = await liveRoom(),
      otherRoom = await room();
    await expect(openRoom(r.id, null, "x".repeat(43))).rejects.toThrow("unavailable");
    await expect(openRoom(otherRoom.id, null, r.token)).rejects.toThrow("unavailable");
    await rotateInvitation(r.id, owner, rows.get(r.id)!.revision);
    await expect(openRoom(r.id, null, r.token)).rejects.toThrow("unavailable");
    const newInvite = await rotateInvitation(r.id, owner, rows.get(r.id)!.revision),
      token = new URL(newInvite.url).hash.slice(1);
    await ownerAct(r.id, { type: "close" });
    expect(rows.get(r.id)!.invitation_hash).toBeNull();
    await expect(
      clientAct(r.id, token, { type: "pick", photoId: r.v.photoId, on: true }),
    ).rejects.toThrow("unavailable");
    await ownerAct(r.id, {
      type: "reopen",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await expect(openRoom(r.id, null, token)).rejects.toThrow("unavailable");
  });
  test("CAS conflict refuses lost updates and an exact retry is idempotent", async () => {
    const r = await liveRoom(),
      before = rows.get(r.id)!.revision,
      op = uid(),
      cmd: DeliveryCommand = {
        type: "comment",
        versionId: r.v.id,
        body: "A little warmer",
        revision: false,
      };
    conflictOnce = true;
    await expect(act(r.id, null, r.token, before, op, cmd)).rejects.toThrow("Another change");
    expect(rows.get(r.id)!.state.comments).toHaveLength(0);
    const saved = await act(r.id, null, r.token, rows.get(r.id)!.revision, op, cmd);
    const retry = await act(r.id, null, r.token, before, op, cmd);
    expect(retry.revision).toBe(saved.revision);
    expect(retry.state.comments).toHaveLength(1);
    await expect(
      act(r.id, null, r.token, saved.revision, op, { ...cmd, body: "Changed" }),
    ).rejects.toThrow("conflict");
  });
  test("client sees proofs but cannot obtain finals until exact-version release", async () => {
    const r = await liveRoom();
    expect((await signedMedia(r.id, null, r.token, [r.v.id], "proof"))[0]!.url).toContain("proof-");
    await expect(signedMedia(r.id, null, r.token, [r.v.id], "full")).rejects.toThrow(
      "not released",
    );
    await clientAct(r.id, r.token, { type: "pick", photoId: r.v.photoId, on: true });
    await clientAct(r.id, r.token, { type: "submit", photoIds: [r.v.photoId] });
    await clientAct(r.id, r.token, { type: "approve", versionId: r.v.id });
    await expect(signedMedia(r.id, null, r.token, [r.v.id], "full")).rejects.toThrow(
      "not released",
    );
    await ownerAct(r.id, { type: "release", versionIds: [r.v.id] });
    expect((await signedMedia(r.id, null, r.token, [r.v.id], "full"))[0]!.url).toContain("full-");
    await clientAct(r.id, r.token, {
      type: "comment",
      versionId: r.v.id,
      body: "One more change",
      revision: true,
    });
    await expect(signedMedia(r.id, null, r.token, [r.v.id], "full")).rejects.toThrow(
      "not released",
    );
  });
  test("private invitations are hash-only in storage and never point clients at localhost", async () => {
    const r = await liveRoom();
    expect(rows.get(r.id)!.invitation_hash).not.toContain(r.token);
    expect(credentialMatches(r.token, rows.get(r.id)!.invitation_hash)).toBe(true);
    process.env["DELIVERY_PUBLIC_ORIGIN"] = "http://localhost:8080";
    await expect(rotateInvitation(r.id, owner, rows.get(r.id)!.revision)).rejects.toThrow("HTTPS");
  });
  test("rate limiting blocks further mutations without changing state", async () => {
    const r = await liveRoom(),
      before = structuredClone(rows.get(r.id));
    allowed = false;
    await expect(
      clientAct(r.id, r.token, { type: "comment", versionId: r.v.id, body: "hi", revision: false }),
    ).rejects.toThrow("Too many");
    expect(rows.get(r.id)).toEqual(before);
  });
  test("partial retries sign only missing immutable objects; lost-success retry signs none", async () => {
    const r = await room(),
      v = await photo(r.id);
    const phone = objectPath(owner, r.id, v, "phone"),
      full = objectPath(owner, r.id, v, "full");
    const bytes = objects.get(phone)!;
    objects.delete(phone);
    objects.delete(full);
    const resumed = await uploadTickets(r.id, owner, v.id);
    expect(resumed.tickets.map((t) => t.kind)).toEqual(["phone", "full"]);
    objects.set(phone, bytes);
    objects.set(full, bytes);
    expect((await uploadTickets(r.id, owner, v.id)).tickets).toHaveLength(0);
    expect((await completeUpload(r.id, owner, v.id)).state.photos[0]!.versions[0]!.ready).toBe(
      true,
    );
  });
  test("storage access failures and mismatched immutable files never create new tickets", async () => {
    const r = await room(),
      v = await photo(r.id);
    storageInfoError = "AccessDenied";
    await expect(uploadTickets(r.id, owner, v.id)).rejects.toThrow("check the saved upload");
    storageInfoError = null;
    objects.set(objectPath(owner, r.id, v, "proof"), new Uint8Array([1]));
    await expect(uploadTickets(r.id, owner, v.id)).rejects.toThrow("different size");
    expect(calls.some((c) => c.includes("/object/upload/sign/"))).toBe(false);
  });
  test("approved-owner admission and byte budget fail closed before upload tickets", async () => {
    approved = false;
    await expect(room()).rejects.toThrow("approved-account");
    approved = true;
    const r = await room(),
      v = await photo(r.id);
    quotaAvailable = false;
    await expect(uploadTickets(r.id, owner, v.id)).rejects.toThrow("allowance");
    expect(calls.some((c) => c.includes("/object/upload/sign/"))).toBe(false);
  });
  test("bucket size-limit drift cannot bypass pending-byte charges", async () => {
    const r = await room(),
      v = await photo(r.id);
    for (const limit of [null, 0, 31457281]) {
      bucketLimit = limit;
      expect((await deliveryReadiness()).ready).toBe(false);
      await expect(uploadTickets(r.id, owner, v.id)).rejects.toThrow("Private media");
    }
    expect(calls.some((c) => c.includes("/object/upload/sign/"))).toBe(false);
  });
  test("verification admission prevents media reads; every acquired lease is released on failure", async () => {
    const r = await room(),
      v = await photo(r.id);
    verificationAvailable = false;
    await expect(completeUpload(r.id, owner, v.id)).rejects.toThrow("busy");
    expect(calls.some((c) => c.startsWith("GET /storage/v1/object/delivery"))).toBe(false);
    verificationAvailable = true;
    objects.delete(objectPath(owner, r.id, v, "proof"));
    await expect(completeUpload(r.id, owner, v.id)).rejects.toThrow("incomplete");
    expect(calls).toContain("POST /rest/v1/rpc/delivery_release_verification");
  });
  test("exhausted activity cannot block closure or replay; previous history is untouched", async () => {
    const r = await liveRoom(),
      row = rows.get(r.id)!;
    row.state.events = Array.from({ length: 20000 }, (_, i) => ({
      id: uid(),
      at: new Date().toISOString(),
      role: "client",
      text: `event ${i}`,
    }));
    const old = structuredClone(row.state.events),
      revision = row.revision,
      op = uid();
    const closed = await act(r.id, owner, "", revision, op, { type: "close" });
    expect(closed.state.status).toBe("closed");
    expect(closed.state.events).toEqual(old);
    expect((await act(r.id, owner, "", revision, op, { type: "close" })).revision).toBe(
      closed.revision,
    );
    await expect(signedMedia(r.id, null, r.token, [r.v.id], "proof")).rejects.toThrow(
      "unavailable",
    );
  });
});
