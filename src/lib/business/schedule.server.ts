/** Due posts fire here. Tokens stay on the server. One attempt per network. */
import { businessDatabase } from "./database.server";
import { facebookConfigured, publishFacebookPage } from "./facebook.server";
import { instagramCall, instagramConfigured, instagramSession, openToken, sealToken } from "./instagram.server";
import { postPasteNetwork, type PasteImage } from "../social-paste-post";
import type { PasteSecret } from "../social-paste";
import { isPasteSocial } from "../social-paste";
import {
  isScheduleRecord,
  parseScheduleInput,
  SCHEDULE_KIND,
  type LivePostNetwork,
  type ScheduleRecord,
  type ScheduleResult,
} from "../social/schedule";

const BUCKET = "publishing-media-v1";
const TICK_LIMIT = 20;

function tokenKey(): Buffer | null {
  const key = process.env["SOCIAL_TOKEN_KEY"];
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) return null;
  return Buffer.from(key, "hex");
}

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function newRecord(
  owner: string,
  input: { caption: string; networks: LivePostNetwork[]; runAt: string },
  extras: Partial<ScheduleRecord> = {},
): ScheduleRecord {
  return {
    kind: SCHEDULE_KIND,
    caption: input.caption,
    networks: input.networks,
    runAt: input.runAt,
    status: "scheduled",
    results: [],
    createdAt: iso(),
    ...extras,
  };
}

export async function listSchedule(owner: string): Promise<ScheduleRecord[]> {
  const { data, error } = await businessDatabase()
    .from("social_publications")
    .select("id, record")
    .eq("owner_id", owner)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Schedule storage is unavailable.");
  return (data ?? [])
    .map((row) =>
      isScheduleRecord(row.record) ? { ...row.record, id: String(row.id) } : null,
    )
    .filter((row): row is ScheduleRecord => Boolean(row))
    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
}

export async function createSchedule(
  owner: string,
  raw: {
    caption: unknown;
    networks: unknown;
    runAt: unknown;
    secrets?: unknown;
    image?: { mime?: unknown; data?: unknown };
  },
): Promise<ScheduleRecord> {
  const input = parseScheduleInput(raw);
  const db = businessDatabase();
  const { count, error: countError } = await db
    .from("social_publications")
    .select("id", { head: true, count: "exact" })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 1000) throw new Error("Publishing storage is full or unavailable.");
  const id = crypto.randomUUID();
  const extras: Partial<ScheduleRecord> = {};
  const paste = input.networks.filter((id) => isPasteSocial(id));
  if (paste.length) {
    const key = tokenKey();
    if (!key) throw new Error("Hosting is missing SOCIAL_TOKEN_KEY.");
    if (!Array.isArray(raw.secrets) || raw.secrets.length < paste.length)
      throw new Error("Connect those accounts first.");
    extras.sealedSecrets = sealToken(JSON.stringify(raw.secrets), `schedule:${owner}`, key);
  }
  if (raw.image && typeof raw.image.data === "string" && raw.image.data.length) {
    const mime = raw.image.mime === "image/png" ? "image/png" : "image/jpeg";
    const bytes = Uint8Array.from(atob(raw.image.data), (ch) => ch.charCodeAt(0));
    if (bytes.length < 32 || bytes.length > 1_500_000) throw new Error("That photo is too large.");
    const path = `${owner}/${id}/schedule.jpg`;
    const stored = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (stored.error) throw new Error("Could not store this photo for the scheduled post.");
    extras.imagePath = path;
    extras.imageMime = mime;
  }
  if (input.networks.includes("instagram") && !extras.imagePath)
    throw new Error("Instagram needs a photo.");
  const record = newRecord(owner, input, extras);
  const { error } = await db.from("social_publications").insert({ id, owner_id: owner, record });
  if (error) throw new Error("Could not save this scheduled post.");
  if (Date.parse(input.runAt) <= Date.now() + 15_000) {
    return runSchedule(owner, id);
  }
  return { ...record, id };
}

export async function cancelSchedule(owner: string, id: string): Promise<ScheduleRecord> {
  const db = businessDatabase();
  const { data, error } = await db
    .from("social_publications")
    .select("record")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (error || !data || !isScheduleRecord(data.record)) throw new Error("That post is not on the calendar.");
  if (data.record.status !== "scheduled") throw new Error("That post already ran.");
  const record: ScheduleRecord = { ...data.record, id, status: "cancelled" };
  const saved = await db
    .from("social_publications")
    .update({ record })
    .eq("id", id)
    .eq("owner_id", owner);
  if (saved.error) throw new Error("Could not cancel this post.");
  return record;
}

async function signedImage(path: string): Promise<{ url: string; image: PasteImage } | null> {
  const db = businessDatabase();
  const signed = await db.storage.from(BUCKET).createSignedUrl(path, 15 * 60);
  if (signed.error || !signed.data?.signedUrl) return null;
  const file = await db.storage.from(BUCKET).download(path);
  if (file.error || !file.data) return { url: signed.data.signedUrl, image: { mime: "image/jpeg", bytes: new Uint8Array() } };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const mime = file.data.type === "image/png" ? "image/png" : "image/jpeg";
  return { url: signed.data.signedUrl, image: { mime, bytes } };
}

async function publishInstagram(owner: string, caption: string, imageUrl: string): Promise<ScheduleResult> {
  try {
    if (!instagramConfigured()) return { id: "instagram", ok: false, error: "Instagram is not configured." };
    const session = await instagramSession(owner);
    const created = await instagramCall(`${session.accountId}/media`, session.token, {
      body: new URLSearchParams({ image_url: imageUrl, caption }),
    });
    const container = typeof created.id === "string" ? created.id : "";
    if (!container) return { id: "instagram", ok: false, error: "Instagram did not take this photo." };
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500 + i * 400));
      const status = await instagramCall(`${container}?fields=status_code`, session.token);
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR")
        return { id: "instagram", ok: false, error: "Instagram rejected this photo." };
    }
    const published = await instagramCall(`${session.accountId}/media_publish`, session.token, {
      body: new URLSearchParams({ creation_id: container }),
    });
    const mediaId = typeof published.id === "string" ? published.id : "";
    let url: string | undefined;
    if (mediaId) {
      const read = await instagramCall(`${mediaId}?fields=permalink`, session.token).catch(() => null);
      if (read && typeof read.permalink === "string") url = read.permalink;
    }
    return { id: "instagram", ok: true, ...(url ? { url } : {}) };
  } catch (error) {
    return {
      id: "instagram",
      ok: false,
      error: error instanceof Error ? error.message : "Instagram rejected this post.",
    };
  }
}

async function dispatch(owner: string, record: ScheduleRecord): Promise<ScheduleResult[]> {
  const key = tokenKey();
  const secrets: PasteSecret[] = record.sealedSecrets && key
    ? (JSON.parse(openToken(record.sealedSecrets, `schedule:${owner}`, key)) as PasteSecret[])
    : [];
  const media = record.imagePath ? await signedImage(record.imagePath) : null;
  const results: ScheduleResult[] = [];
  for (const network of record.networks) {
    if (network === "instagram") {
      results.push(
        media?.url
          ? await publishInstagram(owner, record.caption, media.url)
          : { id: "instagram", ok: false, error: "Instagram needs a photo." },
      );
      continue;
    }
    if (network === "facebook") {
      if (!facebookConfigured()) {
        results.push({ id: "facebook", ok: false, error: "Facebook is not configured." });
        continue;
      }
      const posted = await publishFacebookPage(owner, {
        caption: record.caption,
        ...(media?.url ? { imageUrl: media.url } : {}),
      });
      results.push({
        id: "facebook",
        ok: posted.ok,
        ...(posted.ok ? { url: posted.url } : { error: posted.error }),
      });
      continue;
    }
    const secret = secrets.find((row) => row.id === network);
    if (!secret) {
      results.push({ id: network, ok: false, error: "Connect this account first." });
      continue;
    }
    const posted = await postPasteNetwork({
      secret,
      caption: record.caption,
      ...(media?.image.bytes.length ? { image: media.image } : {}),
    });
    results.push({
      id: network,
      ok: posted.ok,
      ...(posted.ok ? {} : { error: posted.error }),
    });
  }
  return results;
}

export async function runSchedule(owner: string, id: string): Promise<ScheduleRecord> {
  const db = businessDatabase();
  const lease = crypto.randomUUID();
  const { data, error } = await db
    .from("social_publications")
    .update({ lease, lease_until: iso(Date.now() + 180_000) })
    .eq("id", id)
    .eq("owner_id", owner)
    .or(`lease.is.null,lease_until.lt.${iso()}`)
    .select("record")
    .maybeSingle();
  if (error || !data || !isScheduleRecord(data.record))
    throw new Error("This post is already running or unavailable.");
  if (data.record.status === "posted" || data.record.status === "cancelled")
    return { ...data.record, id };
  const posting: ScheduleRecord = { ...data.record, id, status: "posting" };
  await db.from("social_publications").update({ record: posting }).eq("id", id).eq("owner_id", owner);
  const results = await dispatch(owner, posting);
  const ok = results.some((row) => row.ok);
  const record: ScheduleRecord = {
    ...posting,
    status: ok ? "posted" : "failed",
    results,
    postedAt: iso(),
  };
  await db
    .from("social_publications")
    .update({ record, lease: null, lease_until: null })
    .eq("id", id)
    .eq("owner_id", owner);
  return { ...record, id };
}

export async function tickDuePosts(now = Date.now()): Promise<{ ran: number }> {
  const db = businessDatabase();
  const { data, error } = await db
    .from("social_publications")
    .select("id, owner_id, record")
    .limit(400);
  if (error || !data) return { ran: 0 };
  const due = data.filter((row) => {
    const record = row.record;
    return (
      isScheduleRecord(record) &&
      record.status === "scheduled" &&
      Date.parse(record.runAt) <= now
    );
  }).slice(0, TICK_LIMIT);
  let ran = 0;
  for (const row of due) {
    try {
      await runSchedule(row.owner_id as string, row.id as string);
      ran++;
    } catch {
      /* next due post still runs */
    }
  }
  return { ran };
}
