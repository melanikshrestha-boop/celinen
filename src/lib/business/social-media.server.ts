/** Media for scheduled social posts: where bytes live, how the page uploads
 * them, how the Worker re-verifies them, and how a provider fetches them.
 *
 * Photos reuse the private `publishing-media-v1` bucket (JPEG, 8 MiB). Video
 * has its own private bucket, `publishing-video-v1`, because the Instagram
 * publisher pins the photo bucket's JPEG-only policy as a safety check.
 *
 * Nothing here loads a whole video into memory: hashing and MP4 probing read
 * byte ranges through Supabase's storage API, so a 1 GB clip costs the Worker
 * one chunk at a time.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { businessDatabase } from "./database.server";
import { PUBLISHING_BUCKET, sha256Hex } from "../social/instagram-post";
import {
  SocialApiError,
  imageDimensions,
  probeMp4,
  type MediaItem,
  type StoredMedia,
} from "../social/connectors";

export const IMAGE_BUCKET = PUBLISHING_BUCKET;
export const VIDEO_BUCKET = "publishing-video-v1";
export const VIDEO_BUCKET_BYTES = 1024 * 1024 * 1024;
/** A provider fetches the file when the container/post is created; the URL need not outlive that. */
export const SIGNED_URL_SECONDS = 15 * 60;
export const RANGE_CHUNK = 8 * 1024 * 1024;

type Database = ReturnType<typeof businessDatabase>;
export type MediaDeps = {
  db: Database;
  env: Record<string, string | undefined>;
  now: () => number;
  /** Bytes [start, end] inclusive of a stored object. */
  readRange: (bucket: string, path: string, start: number, end: number) => Promise<Uint8Array>;
  objectInfo: (
    bucket: string,
    path: string,
  ) => Promise<{ size: number; contentType: string } | null>;
};

function storageAuth(env: Record<string, string | undefined>) {
  const url = env["SUPABASE_URL"],
    key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new SocialApiError("Media storage is not configured.", "config");
  return { url: url.replace(/\/$/, ""), key };
}

/** Supabase storage serves private objects to the service role with HTTP Range. */
export async function readStorageRange(
  env: Record<string, string | undefined>,
  bucket: string,
  path: string,
  start: number,
  end: number,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const { url, key } = storageAuth(env);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await request(`${url}/storage/v1/object/${bucket}/${encoded}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new SocialApiError("The media could not be read from storage.", "unavailable", 0);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A server that ignores Range answers 200 with the whole object.
  return response.status === 206 ? bytes : bytes.subarray(start, end + 1);
}

export function mediaDeps(overrides: Partial<MediaDeps> = {}): MediaDeps {
  const db = overrides.db ?? businessDatabase();
  const env = overrides.env ?? (process.env as Record<string, string | undefined>);
  return {
    db,
    env,
    now: overrides.now ?? Date.now,
    readRange:
      overrides.readRange ??
      ((bucket, path, start, end) => readStorageRange(env, bucket, path, start, end)),
    objectInfo:
      overrides.objectInfo ??
      (async (bucket, path) => {
        const info = await db.storage.from(bucket).info(path);
        if (info.error || !info.data) return null;
        return {
          size: Number(info.data.size ?? 0),
          contentType: String(info.data.contentType ?? ""),
        };
      }),
  };
}

/** Paths derive from the verified owner and server-checked post id only. */
export function storedMedia(
  owner: string,
  postId: string,
  media: readonly MediaItem[],
): StoredMedia[] {
  return media.map((item, index) =>
    item.kind === "image"
      ? { ...item, bucket: IMAGE_BUCKET, path: `${owner}/social/${postId}/${index}.jpg` }
      : {
          ...item,
          bucket: VIDEO_BUCKET,
          path: `${owner}/social/${postId}/${index}.${item.mime === "video/quicktime" ? "mov" : "mp4"}`,
        },
  );
}

export type UploadTicket = { bucket: string; path: string; token: string; mime: string };
/** Owner-scoped signed upload tickets; upsert lets an interrupted upload retry. */
export async function uploadTickets(
  deps: MediaDeps,
  media: readonly StoredMedia[],
): Promise<UploadTicket[]> {
  const tickets: UploadTicket[] = [];
  for (const item of media) {
    const signed = await deps.db.storage
      .from(item.bucket)
      .createSignedUploadUrl(item.path, { upsert: true });
    if (signed.error || !signed.data?.token)
      throw new SocialApiError("Could not prepare the upload. Nothing was posted.", "unavailable");
    tickets.push({
      bucket: item.bucket,
      path: item.path,
      token: signed.data.token,
      mime: item.mime,
    });
  }
  return tickets;
}

const bucketsChecked = new Map<string, number>();
/** Both buckets must be private and typed exactly as the migrations wrote them. */
export async function bucketsAreSafe(deps: MediaDeps) {
  const cached = bucketsChecked.get("ok");
  if (cached && deps.now() - cached < 10 * 60_000) return true;
  const image = await deps.db.storage.getBucket(IMAGE_BUCKET);
  const video = await deps.db.storage.getBucket(VIDEO_BUCKET);
  const ok =
    !image.error &&
    !!image.data &&
    !image.data.public &&
    image.data.file_size_limit === 8388608 &&
    image.data.allowed_mime_types?.length === 1 &&
    image.data.allowed_mime_types[0] === "image/jpeg" &&
    !video.error &&
    !!video.data &&
    !video.data.public &&
    Number(video.data.file_size_limit) <= VIDEO_BUCKET_BYTES &&
    (video.data.allowed_mime_types ?? []).every(
      (mime) => mime === "video/mp4" || mime === "video/quicktime",
    ) &&
    (video.data.allowed_mime_types?.length ?? 0) > 0;
  if (ok) bucketsChecked.set("ok", deps.now());
  return ok;
}

const mismatch = () =>
  new SocialApiError(
    "An uploaded file does not match what you confirmed. Post again.",
    "media",
    400,
  );
const missing = () =>
  new SocialApiError("The media has not finished uploading. Try again.", "media", 400);

/** Every byte a provider will fetch is the byte the photographer confirmed. */
export async function verifyStoredMedia(deps: MediaDeps, item: StoredMedia): Promise<void> {
  if (item.kind === "image") {
    const file = await deps.db.storage.from(item.bucket).download(item.path);
    if (file.error || !file.data) throw missing();
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const size = imageDimensions(bytes);
    if (
      bytes.byteLength !== item.bytes ||
      !size ||
      size.width !== item.width ||
      size.height !== item.height ||
      (await sha256Hex(bytes)) !== item.sha256
    )
      throw mismatch();
    return;
  }
  const info = await deps.objectInfo(item.bucket, item.path);
  if (!info) throw missing();
  if (info.size !== item.bytes) throw mismatch();
  if (info.contentType && info.contentType !== item.mime) throw mismatch();
  const read = (offset: number, length: number) =>
    deps.readRange(item.bucket, item.path, offset, Math.min(offset + length, item.bytes) - 1);
  const probe = await probeMp4(read, item.bytes);
  if (!probe)
    throw new SocialApiError("The video is not a readable MP4 or MOV file.", "media", 400);
  const durationOff = Math.abs(probe.durationMs - (item.durationMs ?? 0)) > 1500;
  if (durationOff || probe.width !== item.width || probe.height !== item.height) throw mismatch();
  // Streaming SHA-256: the whole file passes through, one range at a time.
  const hash = createHash("sha256");
  for (let offset = 0; offset < item.bytes; offset += RANGE_CHUNK) {
    const end = Math.min(offset + RANGE_CHUNK, item.bytes) - 1;
    const chunk = await deps.readRange(item.bucket, item.path, offset, end);
    if (chunk.byteLength !== end - offset + 1) throw missing();
    hash.update(chunk);
  }
  if (hash.digest("hex") !== item.sha256) throw mismatch();
}

export async function signedMediaUrl(
  deps: MediaDeps,
  item: StoredMedia,
  seconds = SIGNED_URL_SECONDS,
) {
  const signed = await deps.db.storage.from(item.bucket).createSignedUrl(item.path, seconds);
  if (signed.error || !signed.data?.signedUrl)
    throw new SocialApiError("Could not give the network access to the media.", "unavailable");
  return signed.data.signedUrl;
}

/** Downloads a whole image (never a video) for APIs that take bytes. */
export async function downloadImage(deps: MediaDeps, item: StoredMedia): Promise<Uint8Array> {
  if (item.kind !== "image") throw new Error("Videos are read by range.");
  const file = await deps.db.storage.from(item.bucket).download(item.path);
  if (file.error || !file.data) throw missing();
  return new Uint8Array(await file.data.arrayBuffer());
}

export async function removeStoredMedia(deps: MediaDeps, media: readonly StoredMedia[]) {
  const byBucket = new Map<string, string[]>();
  for (const item of media)
    byBucket.set(item.bucket, [...(byBucket.get(item.bucket) ?? []), item.path]);
  for (const [bucket, paths] of byBucket) {
    const removed = await deps.db.storage.from(bucket).remove(paths);
    if (removed.error) return false;
  }
  return true;
}

/** A proxy ticket lets a provider that only pulls from a verified domain fetch
 * one private object through `/api/social-media/<ticket>` for a short while.
 * HMAC-SHA256 over bucket, path and expiry with SOCIAL_TOKEN_KEY; no database. */
export function proxyTicket(
  env: Record<string, string | undefined>,
  item: Pick<StoredMedia, "bucket" | "path">,
  now: number,
  ttlMs = SIGNED_URL_SECONDS * 1000,
): string {
  const key = env["SOCIAL_TOKEN_KEY"];
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key))
    throw new SocialApiError("Missing SOCIAL_TOKEN_KEY.", "config");
  const body = Buffer.from(
    JSON.stringify({ b: item.bucket, p: item.path, e: now + ttlMs }),
  ).toString("base64url");
  const mac = createHmac("sha256", Buffer.from(key, "hex")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function openProxyTicket(
  env: Record<string, string | undefined>,
  ticket: string,
  now: number,
): { bucket: string; path: string } | null {
  const key = env["SOCIAL_TOKEN_KEY"];
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) return null;
  const [body, mac] = ticket.split(".");
  if (!body || !mac || ticket.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket))
    return null;
  const expected = createHmac("sha256", Buffer.from(key, "hex")).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      b?: unknown;
      p?: unknown;
      e?: unknown;
    };
    if (
      (parsed.b !== IMAGE_BUCKET && parsed.b !== VIDEO_BUCKET) ||
      typeof parsed.p !== "string" ||
      !/^[0-9a-f-]{36}\/social\/[0-9a-f-]{36}\/\d{1,2}\.(jpg|mp4|mov)$/.test(parsed.p) ||
      typeof parsed.e !== "number" ||
      parsed.e < now
    )
      return null;
    return { bucket: parsed.b, path: parsed.p };
  } catch {
    return null;
  }
}

export const proxyUrl = (origin: string, ticket: string) => `${origin}/api/social-media/${ticket}`;

/** Streams a private object to a provider, honouring its Range request. */
export async function streamStoredObject(
  env: Record<string, string | undefined>,
  bucket: string,
  path: string,
  range: string | null,
  request: typeof fetch = fetch,
): Promise<Response> {
  const { url, key } = storageAuth(env);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const upstream = await request(`${url}/storage/v1/object/${bucket}/${encoded}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, ...(range ? { Range: range } : {}) },
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("content-disposition", "inline");
  return new Response(upstream.body, { status: upstream.status, headers });
}
