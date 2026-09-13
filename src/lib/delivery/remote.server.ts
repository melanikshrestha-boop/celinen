import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  clientState,
  commandSchema,
  downloadable,
  findVersion,
  isOpen,
  newDelivery,
  objectPath,
  transition,
  variantNames,
  type Actor,
  type DeliveryCommand,
  type DeliveryState,
  type VariantName,
} from "./workflow";
import { verifyJpegStream } from "./verify-stream.server";
import { sameGalleryPresentation } from "./gallery-presentation";

const BUCKET = "delivery-private-v1";
const MAX_OBJECT_BYTES = 30 * 1024 * 1024;
function safeBucket(
  bucket: {
    public: boolean;
    file_size_limit?: number | null;
    allowed_mime_types?: string[] | null;
  } | null,
) {
  return (
    !!bucket &&
    !bucket.public &&
    typeof bucket.file_size_limit === "number" &&
    bucket.file_size_limit > 0 &&
    bucket.file_size_limit <= MAX_OBJECT_BYTES &&
    bucket.allowed_mime_types?.length === 1 &&
    bucket.allowed_mime_types[0] === "image/jpeg"
  );
}
export const MEDIA_TTL = 120;
export type Room = {
  id: string;
  owner_id: string;
  revision: number;
  invitation_hash: string | null;
  state: DeliveryState;
};
export type RoomView = { id: string; revision: number; state: DeliveryState };
function database(signal?: AbortSignal) {
  const url = process.env["SUPABASE_URL"],
    key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key)
    throw new Error(
      "Private delivery is not connected. Configure the server and apply the delivery migration first.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(signal
      ? {
          global: {
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              fetch(input, {
                ...init,
                signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
              }),
          },
        }
      : {}),
  });
}
export async function deliveryReadiness() {
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"])
    return {
      ready: false,
      reason:
        "Private delivery needs its server connection. Your existing local galleries and Studio are untouched.",
    };
  try {
    const db = database();
    const [table, bucket, limits, slots] = await Promise.all([
      db.from("delivery_rooms").select("id").limit(0),
      db.storage.getBucket(BUCKET),
      db.from("delivery_owner_limits").select("owner_id").limit(0),
      db.from("delivery_verification_slots").select("slot").limit(0),
    ]);
    if (table.error || limits.error || slots.error || bucket.error || !safeBucket(bucket.data))
      return {
        ready: false,
        reason:
          "Private delivery is locked until its database migration and private media bucket are verified.",
      };
    return { ready: true, reason: "" };
  } catch {
    return {
      ready: false,
      reason: "The private delivery service is unavailable. Nothing has been published.",
    };
  }
}
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
async function assertPrivateStorage(db = database()) {
  const { data, error } = await db.storage.getBucket(BUCKET);
  if (error || !safeBucket(data))
    throw new Error("Private media access is unavailable. No files were shared.");
}
export function credentialMatches(token: string, stored: string | null) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !stored || !/^[a-f0-9]{64}$/.test(stored)) return false;
  return timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(stored, "hex"));
}
async function rateLimit(key: string, limit = 120, db = database()) {
  const { data, error } = await db.rpc("delivery_take_request", {
    rate_key: digest(key),
    max_requests: limit,
  });
  if (error) throw new Error("Delivery request protection is unavailable. Please retry later.");
  if (!data)
    throw new Error("Too many requests. Wait a minute and retry; your draft is preserved.");
}
async function read(id: string, owner?: string, db = database()): Promise<Room> {
  let query = db
    .from("delivery_rooms")
    .select("id,owner_id,revision,invitation_hash,state")
    .eq("id", id);
  if (owner) query = query.eq("owner_id", owner);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("This link is unavailable.");
  return data as Room;
}
export async function owned(id: string, owner: string, db = database()) {
  const row = await read(id, owner, db);
  if (row.owner_id !== owner) throw new Error("This delivery is not available to this account.");
  return row;
}
export async function invited(id: string, token: string) {
  const { data, error } = await database()
    .from("delivery_rooms")
    .select("invitation_hash")
    .eq("id", id)
    .maybeSingle();
  if (error || !data || !credentialMatches(token, data.invitation_hash))
    throw new Error("This link is unavailable.");
  await rateLimit(`client:${id}:${data.invitation_hash}`);
  await assertPrivateStorage();
  const row = await read(id);
  if (
    !credentialMatches(token, row.invitation_hash) ||
    !isOpen(row.state, new Date().toISOString())
  )
    throw new Error("This link is unavailable.");
  return row;
}
const view = (room: Room, actor: Actor): RoomView => ({
  id: room.id,
  revision: room.revision,
  state: actor === "owner" ? { ...room.state, receipts: [] } : clientState(room.state),
});
export async function listRooms(owner: string) {
  const { data, error } = await database()
    .from("delivery_rooms")
    .select("id,title:state->>title,clientName:state->>clientName,status:state->>status")
    .eq("owner_id", owner)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Could not load deliveries.");
  return data as { id: string; title: string; clientName: string; status: string }[];
}
export async function createRoom(owner: string, input: Parameters<typeof newDelivery>[0]) {
  await approvedOwner(owner);
  await rateLimit(`owner:${owner}:create`, 20);
  const state = newDelivery(input, new Date().toISOString());
  const existing = await database()
    .from("delivery_rooms")
    .select("id,owner_id,revision,invitation_hash,state")
    .eq("id", input.id)
    .maybeSingle();
  if (existing.data) {
    const old = existing.data as Room;
    if (
      old.owner_id !== owner ||
      old.state.title !== state.title ||
      old.state.clientName !== state.clientName ||
      old.state.message !== state.message ||
      old.state.selectionLimit !== state.selectionLimit ||
      (old.state.selectionDeadline ?? null) !== (state.selectionDeadline ?? null) ||
      old.state.expiresAt !== state.expiresAt ||
      !sameGalleryPresentation(old.state, state)
    )
      throw new Error("Delivery ID already exists with different details.");
    return view(old, "owner");
  }
  const { data, error } = await database()
    .from("delivery_rooms")
    .insert({ id: input.id, owner_id: owner, state })
    .select("*")
    .single();
  if (error) throw new Error("Could not create the delivery. Nothing was published.");
  return view(data as Room, "owner");
}
export async function openRoom(id: string, owner: string | null, token: string) {
  return view(
    owner ? await owned(id, owner) : await invited(id, token),
    owner ? "owner" : "client",
  );
}
async function save(
  room: Room,
  state: DeliveryState,
  invitationHash = room.invitation_hash,
): Promise<Room | null> {
  // Bound whole-document allocations before Postgres' last-resort constraint is reached.
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > 4 * 1024 * 1024)
    throw new Error(
      "This delivery reached its metadata budget. Existing work is preserved; start a second gallery. Closing access remains available.",
    );
  const { data, error } = await database()
    .from("delivery_rooms")
    .update({
      state,
      invitation_hash: invitationHash,
      revision: room.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .eq("revision", room.revision)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("The change was not saved. Please retry.");
  return data as Room | null;
}
export async function act(
  id: string,
  owner: string | null,
  token: string,
  expectedRevision: number,
  operationId: string,
  command: DeliveryCommand,
) {
  command = commandSchema.parse(command);
  const actor = owner ? "owner" : "client";
  if (owner) await rateLimit(`owner:${owner}:write`, 300);
  if (owner && command.type === "close") {
    const { data, error } = await database().rpc("delivery_close_room", {
      p_owner: owner,
      p_gallery: id,
      p_revision: expectedRevision,
      p_operation: operationId,
    });
    if (error || !data?.[0]) throw new Error("Could not close this gallery. Refresh and retry.");
    return view(data[0] as Room, "owner");
  }
  if (owner && command.type === "reserve") await approvedOwner(owner);
  const room = owner ? await owned(id, owner) : await invited(id, token);
  const fingerprint = digest(`${actor}:${JSON.stringify(command)}`);
  const receipt = room.state.receipts.find((r) => r.id === operationId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new Error("Operation ID conflict.");
    return view(room, actor);
  }
  if (expectedRevision !== room.revision)
    throw new Error(
      "This gallery changed on another device. Refresh and try again; your message is preserved.",
    );
  const state = transition(
    room.state,
    command,
    actor,
    operationId,
    fingerprint,
    new Date().toISOString(),
  );
  // Closing revokes the invitation permanently; reopening never restores an old link.
  const saved = await save(room, state, command.type === "close" ? null : room.invitation_hash);
  if (!saved)
    throw new Error("Another change arrived first. Refresh and retry; nothing was overwritten.");
  return view(saved, actor);
}
export async function rotateInvitation(id: string, owner: string, revision: number) {
  const configured = process.env["DELIVERY_PUBLIC_ORIGIN"];
  if (!configured)
    throw new Error(
      "The deployed client gallery address is not configured. A localhost link cannot be sent to your client.",
    );
  const origin = new URL(configured);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    /^(localhost|127\.|0\.|\[::1\]|192\.168\.|10\.)/i.test(origin.hostname)
  )
    throw new Error("Configure the verified HTTPS address of the deployed client gallery.");
  await assertPrivateStorage();
  await rateLimit(`owner:${owner}:invitations`, 20);
  const room = await owned(id, owner);
  if (room.revision !== revision || !isOpen(room.state, new Date().toISOString()))
    throw new Error("Publish this gallery and refresh before creating a link.");
  const token = randomBytes(32).toString("base64url");
  const state = structuredClone(room.state);
  state.events.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    role: "owner",
    text: "Private invitation replaced; previous link revoked",
  });
  const saved = await save(room, state, digest(token));
  if (!saved) throw new Error("Gallery changed. Refresh before creating a link.");
  return { room: view(saved, "owner"), url: `${origin.origin}/review/${id}#${token}` };
}
export async function uploadTickets(id: string, owner: string, versionId: string) {
  const room = await owned(id, owner);
  await assertPrivateStorage();
  await rateLimit(`owner:${owner}:uploads`, 120);
  const { version } = findVersion(room.state, versionId);
  if (version.ready) return { ready: true as const, tickets: [] };
  const db = database();
  const allocation = await db.rpc("delivery_reserve_upload", {
    p_owner: owner,
    p_gallery: id,
    p_version: versionId,
    p_fingerprint: digest(
      variantNames
        .map((kind) => {
          const v = version.variants[kind];
          return `${kind}:${v.sha256}:${v.bytes}:${v.width}:${v.height}`;
        })
        .join("|"),
    ),
  });
  if (allocation.error || allocation.data !== true)
    throw new Error(
      "Upload allowance is unavailable or full. Your files are preserved; contact your studio administrator before retrying.",
    );
  const tickets = [];
  for (const kind of variantNames) {
    const path = objectPath(owner, id, version, kind);
    if (await objectPresent(path, version.variants[kind].bytes)) continue;
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data) {
      // Another retry may have completed the same immutable object between check and signing.
      if (await objectPresent(path, version.variants[kind].bytes)) continue;
      throw new Error("Could not reserve private upload access. Retry this file.");
    }
    tickets.push({ kind, path, token: data.token });
  }
  return { ready: false as const, tickets };
}
export async function completeUpload(id: string, owner: string, versionId: string) {
  const token = crypto.randomUUID();
  const controller = new AbortController();
  const db = database(controller.signal);
  let acquired = false;
  const timeout = setTimeout(
    () => controller.abort(new Error("Verification timed out. Retry this photo.")),
    45000,
  );
  try {
    const room = await owned(id, owner, db);
    await assertPrivateStorage(db);
    await rateLimit(`owner:${owner}:verify`, 120, db);
    const { version } = findVersion(room.state, versionId);
    const lease = await db.rpc("delivery_acquire_verification", { p_owner: owner, p_token: token });
    if (lease.error || lease.data !== true)
      throw new Error("Upload verification is busy. Retry shortly; uploaded files are preserved.");
    acquired = true;
    if (!version.ready) {
      for (const kind of variantNames) {
        const expected = version.variants[kind];
        const { data, error } = await db.storage
          .from(BUCKET)
          .download(
            objectPath(owner, id, version, kind),
            {},
            { signal: controller.signal, cache: "no-store" },
          )
          .asStream();
        if (error || !data) throw new Error(`${kind} upload is incomplete. Retry this photo.`);
        await verifyJpegStream(data, expected, controller.signal);
      }
    }
    const settle = async (latest: Room) => {
      const result = await db.rpc("delivery_settle_upload", {
        p_owner: owner,
        p_gallery: id,
        p_version: versionId,
        p_bytes: variantNames.reduce((n, kind) => n + version.variants[kind].bytes, 0),
      });
      if (result.error || result.data !== true)
        throw new Error(
          "Photo verified; upload allowance reconciliation needs a retry. No file was overwritten.",
        );
      return view(latest, "owner");
    };
    // Upload completions commute across photos, so merge safely against the newest revision.
    for (let attempt = 0; attempt < 5; attempt++) {
      controller.signal.throwIfAborted();
      const latest = await owned(id, owner, db);
      if (findVersion(latest.state, versionId).version.ready) return await settle(latest);
      controller.signal.throwIfAborted();
      const state = transition(
        latest.state,
        { type: "complete", versionId },
        "owner",
        crypto.randomUUID(),
        digest(`complete:${versionId}`),
        new Date().toISOString(),
      );
      if (Buffer.byteLength(JSON.stringify(state), "utf8") > 4 * 1024 * 1024)
        throw new Error("This gallery reached its metadata budget. Existing files are preserved.");
      const commit = await db.rpc("delivery_commit_verified", {
        p_owner: owner,
        p_gallery: id,
        p_revision: latest.revision,
        p_state: state,
        p_token: token,
      });
      if (commit.error)
        throw new Error(
          "Verification could not be committed. Retry this photo; uploaded files are preserved.",
        );
      if (commit.data?.[0]) return await settle(commit.data[0] as Room);
    }
    throw new Error("Uploads are busy. Retry verification; uploaded files are preserved.");
  } finally {
    clearTimeout(timeout);
    controller.abort();
    // Token-scoped release cannot free a newer request's slot. Expiry also recovers crashes.
    if (acquired)
      await database(AbortSignal.timeout(5000))
        .rpc("delivery_release_verification", { p_owner: owner, p_token: token })
        .then(
          () => {},
          () => {},
        );
  }
}

async function approvedOwner(owner: string) {
  const { data, error } = await database()
    .from("delivery_owner_limits")
    .select("enabled")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error || data?.enabled !== true)
    throw new Error(
      "Private delivery is an approved-account pilot. Ask your studio administrator to enable this account.",
    );
}

async function objectPresent(path: string, expectedBytes: number) {
  const { data, error } = await database().storage.from(BUCKET).info(path);
  if (data && !error) {
    if (data.size !== expectedBytes)
      throw new Error(
        "An uploaded file has a different size. Re-export as a new version; the existing object was not overwritten.",
      );
    return true;
  }
  const details = error as {
    code?: string;
    status?: number;
    statusCode?: string;
    message?: string;
  } | null;
  if (
    details?.code === "NoSuchKey" ||
    (!details?.code &&
      [400, 404].includes(details?.status ?? 0) &&
      details?.statusCode === "404" &&
      /object not found/i.test(details.message ?? ""))
  )
    return false;
  throw new Error(
    "Could not check the saved upload. Retry when storage is available; nothing was overwritten.",
  );
}
export async function signedMedia(
  id: string,
  owner: string | null,
  token: string,
  versionIds: string[],
  kind: VariantName,
) {
  const room = owner ? await owned(id, owner) : await invited(id, token);
  await assertPrivateStorage();
  const now = new Date().toISOString();
  const paths = versionIds.map((versionId) => {
    const { version, photo } = findVersion(room.state, versionId);
    if (!version.ready) throw new Error("Upload not verified.");
    if (
      !owner &&
      (photo.published !== versionId ||
        (kind !== "proof" && !downloadable(room.state, versionId, now)))
    )
      throw new Error("This file is not released for download.");
    return objectPath(room.owner_id, id, version, kind);
  });
  const remaining = Math.floor((Date.parse(room.state.expiresAt) - Date.now()) / 1000);
  const ttl = owner ? MEDIA_TTL : Math.min(MEDIA_TTL, remaining);
  if (ttl <= 0) throw new Error("This link is unavailable.");
  const { data, error } = await database().storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error || !data || data.some((item) => item.error || !item.signedUrl))
    throw new Error("Could not open the requested photos. Please refresh.");
  if (data.length !== versionIds.length)
    throw new Error("Incomplete media response. Please retry.");
  return data.map((item, index) => ({
    versionId: versionIds[index]!,
    url: item.signedUrl!,
    expiresAt: Date.now() + ttl * 1000,
  }));
}
