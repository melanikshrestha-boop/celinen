/** The calendar: create → tickets → ready → tick → posted, per network, with
 * every never-twice rule exercised against recorded provider answers.
 * Nothing here touches the network.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FakeNetwork,
  FakeSocialDatabase,
  fixtureMp4,
  metaError,
  sha256,
} from "./social-connectors-fixtures";
import { ENV } from "./social-connectors.test";
import {
  connectionDeps,
  finishSocialConnection,
  startSocialConnection,
} from "../src/lib/business/social-connections.server";
import { mediaDeps } from "../src/lib/business/social-media.server";
import {
  cancelSchedule,
  createSchedule,
  listSchedule,
  readySchedule,
  rescheduleSchedule,
  runSchedule,
  scheduleDeps,
  sweepSchedule,
  tickDuePosts,
  type ScheduleDeps,
} from "../src/lib/business/schedule.server";
import type { InstagramSession } from "../src/lib/business/instagram.server";
import type { FacebookPageSession } from "../src/lib/business/facebook.server";
import { jpegDimensions } from "../src/lib/social/instagram-post";
import { instantiateSocialWasm } from "../src/lib/social/wasm/engine";
import type { SocialProvider } from "../src/lib/social/connectors";
import type { ScheduleRecord } from "../src/lib/social/schedule";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const IMAGE_BUCKET = "publishing-media-v1";
const VIDEO_BUCKET = "publishing-video-v1";

let photo: Uint8Array;
let photo2: Uint8Array;
beforeAll(async () => {
  const engine = await instantiateSocialWasm(
    readFileSync(new URL("../src/lib/social/wasm/celinen-social.wasm", import.meta.url)),
  );
  photo = engine.frame(new Uint8ClampedArray(64 * 80 * 4).fill(120), 64, 80, {
    format: "portrait",
    x: 0.5,
    y: 0.5,
    zoom: 1,
  });
  photo2 = engine.frame(new Uint8ClampedArray(64 * 80 * 4).fill(40), 64, 80, {
    format: "portrait",
    x: 0.5,
    y: 0.5,
    zoom: 1,
  });
});

function world() {
  const db = new FakeSocialDatabase();
  const net = new FakeNetwork();
  let clock = Date.parse("2026-09-18T12:00:00Z");
  db.now = () => clock;
  const instagram: InstagramSession = {
    owner: OWNER,
    accountId: "17841400000000001",
    username: "sideline.studio",
    accountType: "BUSINESS",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    token: "ig-token",
    expiresAt: new Date(clock + 50 * 86_400_000).toISOString(),
  };
  const facebook: FacebookPageSession = {
    pageId: "100000000000001",
    pageName: "Sideline Studio",
    token: "fb-page-token",
  };
  const base = connectionDeps({
    db: db as never,
    fetch: net.fetch,
    now: () => clock,
    sleep: async () => {},
    env: ENV,
    instagramSession: async (owner) => {
      if (owner !== OWNER) throw new Error("Connect Instagram first.");
      return instagram;
    },
    facebookSession: async (owner) => {
      if (owner !== OWNER) throw new Error("Connect Facebook first.");
      return facebook;
    },
  });
  const deps: ScheduleDeps = scheduleDeps({
    ...base,
    media: mediaDeps({
      db: db as never,
      env: ENV,
      now: () => clock,
      readRange: db.readRange,
      objectInfo: db.objectInfo,
    }),
  });
  return { db, net, deps, tick: (ms: number) => (clock += ms), clock: () => clock, instagram };
}
type World = ReturnType<typeof world>;

async function connect(w: World, provider: SocialProvider) {
  const state = new URL(await startSocialConnection(OWNER, provider, w.deps)).searchParams.get(
    "state",
  )!;
  await finishSocialConnection(OWNER, provider, "code", state, w.deps);
}

const photoItem = (bytes: Uint8Array = photo) => {
  const size = jpegDimensions(bytes)!;
  return {
    kind: "image" as const,
    mime: "image/jpeg" as const,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    width: size.width,
    height: size.height,
  };
};
const videoItem = (bytes: Uint8Array, durationMs = 5000) => ({
  kind: "video" as const,
  mime: "video/mp4" as const,
  bytes: bytes.byteLength,
  sha256: sha256(bytes),
  width: 1080,
  height: 1920,
  durationMs,
});

/** Schedules, uploads what the tickets ask for, and marks the post ready. */
async function schedule(
  w: World,
  input: {
    networks: string[];
    caption?: string;
    media?: unknown[];
    runAt?: string;
    id?: string;
    unitKind?: string;
    title?: string;
    options?: unknown;
  },
  files: Record<string, Uint8Array> = {},
) {
  const created = await createSchedule(
    OWNER,
    {
      id: input.id ?? GROUP,
      caption: input.caption ?? "Gallery tonight.",
      networks: input.networks,
      runAt: input.runAt ?? new Date(w.clock() + 60_000).toISOString(),
      media: input.media ?? [],
      ...(input.unitKind ? { unitKind: input.unitKind } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.options ? { options: input.options } : {}),
    },
    w.deps,
  );
  for (const ticket of created.uploads) {
    const bytes = files[ticket.path.split("/").pop()!] ?? photo;
    w.db.upload(ticket.bucket, ticket.path, bytes, ticket.mime);
  }
  if (!created.uploads.length) return created;
  return { ...(await readySchedule(OWNER, created.id, w.deps)), uploads: created.uploads };
}
const row = (w: World, id = GROUP) =>
  w.db.rows("social_publications").find((r) => r.id === id)!.record as ScheduleRecord;

describe("create, ready, list, cancel, reschedule", () => {
  test("a post with media is not runnable until every upload landed; the same id never schedules twice", async () => {
    const w = world();
    await connect(w, "threads");
    const created = await createSchedule(
      OWNER,
      {
        id: GROUP,
        caption: "Hi",
        networks: ["threads"],
        runAt: new Date(w.clock()).toISOString(),
        media: [photoItem()],
      },
      w.deps,
    );
    expect(created.uploads).toEqual([
      {
        bucket: IMAGE_BUCKET,
        path: `${OWNER}/social/${GROUP}/0.jpg`,
        token: `upload:${IMAGE_BUCKET}:${OWNER}/social/${GROUP}/0.jpg`,
        mime: "image/jpeg",
      },
    ]);
    expect(created.nextAttemptAt).toBeNull();
    expect(JSON.stringify(created)).not.toContain("progress");
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 0 });
    // Sent again with the same id: same post, fresh tickets, no second row.
    const again = await createSchedule(
      OWNER,
      {
        id: GROUP,
        caption: "Hi",
        networks: ["threads"],
        runAt: new Date(w.clock()).toISOString(),
        media: [photoItem()],
      },
      w.deps,
    );
    expect(again.id).toBe(GROUP);
    expect(again.uploads).toHaveLength(1);
    expect(w.db.rows("social_publications")).toHaveLength(1);
    await expect(
      createSchedule(
        OWNER,
        { id: GROUP, caption: "Different", networks: ["threads"], runAt: new Date().toISOString() },
        w.deps,
      ),
    ).rejects.toThrow(/different content/);
    w.db.upload(IMAGE_BUCKET, created.uploads[0]!.path, photo);
    const ready = await readySchedule(OWNER, GROUP, w.deps);
    expect(ready.status).toBe("posted");
    expect(ready.units?.threads).toMatchObject({
      status: "posted",
      result: {
        remoteId: "18000000000000001",
        url: "https://www.threads.net/@sideline.threads/post/FIX",
      },
    });
    expect(w.db.removed).toEqual([`${IMAGE_BUCKET}/${OWNER}/social/${GROUP}/0.jpg`]);
  });

  test("refuses what a network cannot take before saving anything", async () => {
    const w = world();
    await connect(w, "x");
    await expect(schedule(w, { networks: ["x"], caption: "y".repeat(281) })).rejects.toThrow(
      /280 characters/,
    );
    await expect(schedule(w, { networks: ["youtube-shorts"], caption: "clip" })).rejects.toThrow(
      /Connect YouTube first/,
    );
    await expect(schedule(w, { networks: ["instagram"], caption: "no photo" })).rejects.toThrow(
      /needs a photo or video/,
    );
    expect(w.db.rows("social_publications")).toHaveLength(0);
    // An X paste token still schedules without an OAuth connection (legacy path).
    const w2 = world();
    await expect(
      createSchedule(
        OWNER,
        { caption: "hi", networks: ["x"], runAt: new Date(w2.clock() + 60_000).toISOString() },
        w2.deps,
      ),
    ).rejects.toThrow(/Connect those accounts first/);
  });

  test("list hides sealed secrets and progress; cancel and reschedule only touch posts still on the calendar", async () => {
    const w = world();
    await connect(w, "linkedin");
    const created = await schedule(w, { networks: ["linkedin"], caption: "Later." });
    const listed = await listSchedule(OWNER, w.deps);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe("scheduled");
    expect(JSON.stringify(listed)).not.toMatch(/sealedSecrets|progress/);
    expect(await listSchedule(OTHER, w.deps)).toEqual([]);
    const moved = await rescheduleSchedule(
      OWNER,
      created.id,
      new Date(w.clock() + 3600_000).toISOString(),
      w.deps,
    );
    expect(moved.nextAttemptAt).toBe(moved.runAt);
    await expect(rescheduleSchedule(OTHER, created.id, moved.runAt, w.deps)).rejects.toThrow(
      /not on the calendar/,
    );
    await expect(cancelSchedule(OTHER, created.id, w.deps)).rejects.toThrow(/not on the calendar/);
    const cancelled = await cancelSchedule(OWNER, created.id, w.deps);
    expect(cancelled.status).toBe("cancelled");
    await expect(cancelSchedule(OWNER, created.id, w.deps)).rejects.toThrow(/already ran/);
    w.tick(3700_000);
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 0 });
    expect(w.net.count("POST", /rest\/posts/)).toBe(0);
  });
});

describe("publishing per platform", () => {
  test("Threads: text, then a carousel with children before one publish", async () => {
    const w = world();
    await connect(w, "threads");
    const text = await schedule(w, {
      networks: ["threads"],
      caption: "Words only.",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(text.status).toBe("posted");
    const container = w.net.find("POST", /threads\.net\/v1\.0\/\d+\/threads$/)!;
    expect(container.form).toMatchObject({ media_type: "TEXT", text: "Words only." });
    w.net.calls.length = 0;
    const carousel = await schedule(
      w,
      {
        id: OTHER,
        networks: ["threads"],
        caption: "Three",
        media: [photoItem(), { ...photoItem(), sha256: "c".repeat(64) }],
      },
      { "1.jpg": photo },
    );
    // The second photo's declared hash does not match: refused before anything is sent.
    expect(carousel.status).toBe("scheduled");
    w.tick(120_000);
    await tickDuePosts(w.clock(), w.deps);
    expect(w.net.count("POST", /threads$/)).toBe(0);
    expect(row(w, OTHER).units?.threads?.lastError).toMatch(/does not match/);
  });

  test("LinkedIn: image upload via the Images API, then one post; the URN comes from x-restli-id", async () => {
    const w = world();
    await connect(w, "linkedin");
    const posted = await schedule(w, {
      networks: ["linkedin"],
      caption: "On the sideline.",
      media: [photoItem()],
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.status).toBe("posted");
    expect(posted.units?.linkedin?.result).toEqual({
      remoteId: "urn:li:share:7000000000000000001",
      url: "https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001",
    });
    const post = w.net.find("POST", /rest\/posts$/)!;
    expect(post.headers.get("linkedin-version")).toMatch(/^\d{6}$/);
    expect(post.json).toMatchObject({
      author: "urn:li:person:AbCdEf123",
      commentary: "On the sideline.",
      lifecycleState: "PUBLISHED",
      content: { media: { id: expect.stringMatching(/^urn:li:image:/) } },
    });
    expect(w.net.count("PUT", /dms-uploads/)).toBe(1);
  });

  test("X: chunked media upload, one tweet, tier limits remembered from the headers", async () => {
    const w = world();
    await connect(w, "x");
    const posted = await schedule(w, {
      networks: ["x"],
      caption: "Clip",
      media: [photoItem()],
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.x).toMatchObject({
      status: "posted",
      result: {
        remoteId: "1700000000000000001",
        url: "https://x.com/sideline/status/1700000000000000001",
      },
    });
    expect(w.net.count("POST", /media\/upload\/initialize/)).toBe(1);
    expect(w.net.count("POST", /\/append$/)).toBe(1);
    expect(w.net.count("POST", /\/finalize$/)).toBe(1);
    expect(w.net.find("POST", /\/tweets$/)!.json).toMatchObject({
      text: "Clip",
      media: { media_ids: [expect.any(String)] },
    });
    const meta = w.db.rows("social_provider_connections")[0]!["meta"] as {
      xDailyPosts?: { limit: number; remaining: number };
    };
    expect(meta.xDailyPosts).toMatchObject({ limit: 17, remaining: 16 });
  });

  test("X: the tier's daily cap is a quota failure that waits for the reset, then retries", async () => {
    const w = world();
    await connect(w, "x");
    w.net.on("POST", /\/tweets$/, () =>
      Response.json(
        { title: "Too Many Requests" },
        {
          status: 429,
          headers: {
            "x-user-limit-24hour-limit": "17",
            "x-user-limit-24hour-remaining": "0",
            "x-user-limit-24hour-reset": String(Math.floor(w.clock() / 1000) + 3 * 3600),
          },
        },
      ),
    );
    const posted = await schedule(w, {
      networks: ["x"],
      caption: "Capped",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.x).toMatchObject({
      status: "scheduled",
      attempts: 1,
      lastError: expect.stringMatching(/daily posting limit.*17 per 24 hours/),
    });
    expect(Date.parse(posted.units!.x!.nextAttemptAt!) - w.clock()).toBeGreaterThanOrEqual(
      3 * 3600_000 - 60_000,
    );
    w.tick(60_000);
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 0 });
    w.net.on("POST", /\/tweets$/, () =>
      Response.json({ data: { id: "1700000000000000002" } }, { status: 201 }),
    );
    w.tick(3 * 3600_000);
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 1, posted: 1 });
    expect(w.net.count("POST", /\/tweets$/)).toBe(2);
  });

  test("YouTube: resumable upload in chunks, quota accounted per Pacific day, Shorts URL for vertical clips", async () => {
    const w = world();
    await connect(w, "youtube");
    const clip = fixtureMp4({ durationMs: 30_000, width: 1080, height: 1920, mdatBytes: 300_000 });
    const posted = await schedule(
      w,
      {
        networks: ["youtube-shorts"],
        caption: "Desc",
        title: "Sideline",
        unitKind: "video",
        media: [videoItem(clip, 30_000)],
        runAt: new Date(w.clock()).toISOString(),
      },
      { "0.mp4": clip },
    );
    expect(posted.units?.["youtube-shorts"]).toMatchObject({
      status: "posted",
      result: { remoteId: "dQw4w9WgXcQ", url: "https://www.youtube.com/shorts/dQw4w9WgXcQ" },
    });
    const open = w.net.find("POST", /uploadType=resumable/)!;
    expect(open.headers.get("x-upload-content-length")).toBe(String(clip.byteLength));
    expect(open.json).toMatchObject({
      snippet: { title: "Sideline", description: "Desc" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    });
    const meta = w.db.rows("social_provider_connections")[0]!["meta"] as {
      youtubeQuota?: { used: number };
    };
    expect(meta.youtubeQuota?.used).toBe(1600);
    // Sixth upload of the day is refused here, before any bytes move.
    (
      w.db.rows("social_provider_connections")[0]!["meta"] as {
        youtubeQuota: { day: string; used: number };
      }
    ).youtubeQuota.used = 9000;
    w.net.calls.length = 0;
    const capped = await schedule(
      w,
      {
        id: OTHER,
        networks: ["youtube-shorts"],
        caption: "Desc",
        title: "Six",
        unitKind: "video",
        media: [videoItem(clip, 30_000)],
        runAt: new Date(w.clock()).toISOString(),
      },
      { "0.mp4": clip },
    );
    expect(capped.units?.["youtube-shorts"]).toMatchObject({
      status: "scheduled",
      lastError: expect.stringMatching(/daily quota/),
    });
    expect(w.net.count("POST", /uploadType=resumable/)).toBe(0);
  });

  test("TikTok: creator info first, chunked FILE_UPLOAD, SELF_ONLY while unaudited, status polled to PUBLISH_COMPLETE", async () => {
    const w = world();
    await connect(w, "tiktok");
    const clip = fixtureMp4({ durationMs: 8_000, mdatBytes: 6 * 1024 * 1024 });
    const posted = await schedule(
      w,
      {
        networks: ["tiktok"],
        caption: "Sideline clip",
        unitKind: "video",
        media: [videoItem(clip, 8_000)],
        runAt: new Date(w.clock()).toISOString(),
        options: { privacy: "PUBLIC_TO_EVERYONE" },
      },
      { "0.mp4": clip },
    );
    expect(posted.units?.tiktok).toMatchObject({
      status: "posted",
      lastError: "Posted privately (unaudited TikTok app).",
      result: { remoteId: "7300000000000000001" },
    });
    const order = w.net.calls
      .filter((call) => /tiktokapis\.com\/v2\/post/.test(call.url))
      .map((call) => call.path);
    expect(order[0]).toBe("/v2/post/publish/creator_info/query/");
    expect(w.net.find("POST", /video\/init/)!.json).toMatchObject({
      post_info: { privacy_level: "SELF_ONLY", title: "Sideline clip" },
      source_info: { source: "FILE_UPLOAD", video_size: clip.byteLength, total_chunk_count: 1 },
    });
    expect(w.net.count("PUT", /open-upload/)).toBe(1);
    expect(w.net.find("PUT", /open-upload/)!.headers.get("content-range")).toBe(
      `bytes 0-${clip.byteLength - 1}/${clip.byteLength}`,
    );
  });

  test("TikTok photo posts pull from the verified proxy URL on PUBLISH_ORIGIN", async () => {
    const w = world();
    await connect(w, "tiktok");
    const posted = await schedule(w, {
      networks: ["tiktok"],
      caption: "Photo set",
      media: [photoItem()],
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.tiktok?.status).toBe("posted");
    const init = w.net.find("POST", /content\/init/)!;
    expect((init.json["source_info"] as { photo_images: string[] }).photo_images[0]).toMatch(
      /^https:\/\/lenslab\.dev\/api\/social-media\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });

  test("Instagram Reels go through the container flow with media_type=REELS", async () => {
    const w = world();
    const clip = fixtureMp4({ durationMs: 15_000, mdatBytes: 1000 });
    const posted = await schedule(
      w,
      {
        networks: ["instagram"],
        caption: "Reel",
        unitKind: "reel",
        media: [videoItem(clip, 15_000)],
        runAt: new Date(w.clock()).toISOString(),
      },
      { "0.mp4": clip },
    );
    expect(posted.units?.instagram).toMatchObject({
      status: "posted",
      result: { remoteId: "17900000000000001", url: "https://www.instagram.com/p/FIXTURE/" },
    });
    expect(w.net.find("POST", /\/media$/)!.form).toMatchObject({
      media_type: "REELS",
      share_to_feed: "true",
      caption: "Reel",
    });
    expect(w.net.count("POST", /media_publish/)).toBe(1);
  });

  test("Facebook Page: text, photo, multi-photo and video each reach the documented endpoint", async () => {
    const w = world();
    const text = await schedule(w, {
      networks: ["facebook"],
      caption: "Text",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(text.units?.facebook?.result?.remoteId).toBe("100000000000001_200000000000002");
    expect(w.net.find("POST", /\/feed$/)!.form).toEqual({ message: "Text" });
    const one = await schedule(w, {
      id: OTHER,
      networks: ["facebook"],
      caption: "One",
      media: [photoItem()],
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(one.units?.facebook?.result?.remoteId).toBe("100000000000001_200000000000001");
    w.net.calls.length = 0;
    const many = await schedule(
      w,
      {
        id: "44444444-4444-4444-8444-444444444444",
        networks: ["facebook"],
        caption: "Many",
        media: [photoItem(), photoItem(photo2)],
        runAt: new Date(w.clock()).toISOString(),
      },
      { "1.jpg": photo2 },
    );
    expect(many.units?.facebook?.result?.remoteId).toBe("100000000000001_200000000000002");
    expect(w.net.count("POST", /\/photos$/)).toBe(2);
    const feed = w.net.find("POST", /\/feed$/)!;
    expect(feed.form["attached_media[0]"]).toMatch(/media_fbid/);
    expect(feed.form["attached_media[1]"]).toMatch(/media_fbid/);
    const clip = fixtureMp4({ durationMs: 4000, mdatBytes: 500 });
    const video = await schedule(
      w,
      {
        id: "55555555-5555-4555-8555-555555555555",
        networks: ["facebook"],
        caption: "Clip",
        unitKind: "video",
        media: [videoItem(clip, 4000)],
        runAt: new Date(w.clock()).toISOString(),
      },
      { "0.mp4": clip },
    );
    expect(video.units?.facebook?.result?.remoteId).toBe("400000000000001");
    expect(w.net.find("POST", /graph-video\.facebook\.com/)!.form).toMatchObject({
      description: "Clip",
    });
  });

  test("one caption to several networks: each unit settles on its own", async () => {
    const w = world();
    await connect(w, "threads");
    await connect(w, "x");
    w.net.on("POST", /\/tweets$/, () =>
      Response.json({ title: "Forbidden", detail: "duplicate content" }, { status: 403 }),
    );
    const posted = await schedule(w, {
      networks: ["threads", "x", "facebook"],
      caption: "Everywhere",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.threads?.status).toBe("posted");
    expect(posted.units?.x).toMatchObject({
      status: "failed",
      lastError: "X already has this post.",
    });
    expect(posted.units?.facebook?.status).toBe("posted");
    expect(posted.status).toBe("posted");
    expect(posted.results.map((r) => [r.id, r.ok])).toEqual([
      ["threads", true],
      ["x", false],
      ["facebook", true],
    ]);
  });
});

describe("never twice", () => {
  test("a lost answer after the visible call becomes uncertain, reconciles from the provider, and is never re-sent", async () => {
    const w = world();
    await connect(w, "threads");
    w.net.on("POST", /threads_publish/, () => new Error("socket hang up"));
    const posted = await schedule(w, {
      networks: ["threads"],
      caption: "Lost",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.threads).toMatchObject({
      status: "uncertain",
      lastError: expect.stringMatching(/will not send it again/),
    });
    expect(posted.status).toBe("uncertain");
    expect(w.net.count("POST", /threads_publish/)).toBe(1);
    // Reconcile: the container says PUBLISHED.
    w.net.on("GET", /\?fields=status,error_message/, () => ({ status: "PUBLISHED" }));
    w.net.on("GET", /\/threads\?fields=id,permalink/, () => ({
      data: [
        {
          id: "18000000000000009",
          permalink: "https://www.threads.net/@s/post/9",
          text: "Lost",
          timestamp: new Date(w.clock()).toISOString(),
        },
      ],
    }));
    w.tick(3 * 60_000);
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 1, posted: 1 });
    expect(row(w).units?.threads?.result).toEqual({
      remoteId: "18000000000000009",
      url: "https://www.threads.net/@s/post/9",
    });
    expect(w.net.count("POST", /threads_publish/)).toBe(1);
  });

  test("a stated refusal after commit is a failure, not an uncertainty; an unknown reconcile is left for a human after three looks", async () => {
    const w = world();
    await connect(w, "linkedin");
    w.net.on("POST", /rest\/posts$/, () =>
      Response.json({ message: "bad", serviceErrorCode: 100 }, { status: 422 }),
    );
    const refused = await schedule(w, {
      networks: ["linkedin"],
      caption: "Refused",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(refused.units?.linkedin?.status).toBe("failed");
    w.net.on("POST", /rest\/posts$/, () => new Error("timeout"));
    w.net.on("GET", /rest\/posts\?author/, () => ({ elements: [] }));
    const lost = await schedule(w, {
      id: OTHER,
      networks: ["linkedin"],
      caption: "Lost",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(lost.units?.linkedin?.status).toBe("uncertain");
    for (let i = 0; i < 3; i++) {
      w.tick(2 * 3600_000);
      await tickDuePosts(w.clock(), w.deps);
    }
    expect(row(w, OTHER).units?.linkedin).toMatchObject({
      status: "uncertain",
      nextAttemptAt: null,
    });
    expect(w.net.count("POST", /rest\/posts$/)).toBe(2);
    w.tick(24 * 3600_000);
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 0 });
  });

  test("a crash while publishing (lease expired, no commit) resumes from saved provider ids", async () => {
    const w = world();
    await connect(w, "x");
    let uploads = 0;
    w.net.on("POST", /media\/upload\/initialize/, () => {
      uploads++;
      return { data: { id: "9001" } };
    });
    // X refuses the post plainly (rate limit) after the media went up: the media id stays, nothing was committed.
    w.net.on("POST", /\/tweets$/, () =>
      Response.json({ title: "Too Many Requests" }, { status: 429 }),
    );
    const first = await schedule(w, {
      networks: ["x"],
      caption: "Resume",
      media: [photoItem()],
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(first.units?.x?.status).toBe("scheduled");
    // Simulate a runner that then died mid-way: row leased (expired) and publishing, media id saved.
    const stored = w.db.rows("social_publications")[0]!;
    const record = stored.record as ScheduleRecord;
    expect(record.units?.x?.progress["mediaIds"]).toEqual(["9001"]);
    expect(record.units?.x?.progress["committedAt"]).toBeUndefined();
    stored["lease"] = "dead-runner";
    stored["lease_until"] = new Date(w.clock() - 1000).toISOString();
    record.units!.x!.status = "publishing";
    record.units!.x!.nextAttemptAt = new Date(w.clock()).toISOString();
    record.units!.x!.progress["resumable"] = true;
    record.status = "posting";
    record.nextAttemptAt = record.units!.x!.nextAttemptAt;
    w.net.on("POST", /\/tweets$/, () =>
      Response.json({ data: { id: "1700000000000000003" } }, { status: 201 }),
    );
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 1, posted: 1 });
    expect(uploads).toBe(1);
    expect(w.net.count("POST", /\/tweets$/)).toBe(2);
  });

  test("two runners on the same post hold at most one lease; overlapping ticks share the work", async () => {
    const w = world();
    await connect(w, "threads");
    let publishes = 0;
    w.net.on("POST", /threads_publish/, () => {
      publishes++;
      return { id: "18000000000000001" };
    });
    await schedule(w, {
      networks: ["threads"],
      caption: "Once",
      runAt: new Date(w.clock() + 1000).toISOString(),
    });
    w.tick(2000);
    const [a, b, c] = await Promise.all([
      tickDuePosts(w.clock(), w.deps),
      tickDuePosts(w.clock(), w.deps),
      runSchedule(OWNER, GROUP, w.deps),
    ]);
    expect(publishes).toBe(1);
    expect(a.ran + b.ran).toBeLessThanOrEqual(2);
    expect(c.status).toBe("posted");
    expect(w.db.rows("social_publications")[0]!["lease"]).toBeNull();
  });

  test("a post confirmed for one account is never sent to a different connected account", async () => {
    const w = world();
    await connect(w, "x");
    await schedule(w, { networks: ["x"], caption: "Mine" });
    w.net.on("GET", /api\.x\.com\/2\/users\/me/, () => ({
      data: { id: "999", username: "someone.else" },
    }));
    await connect(w, "x");
    w.tick(120_000);
    await tickDuePosts(w.clock(), w.deps);
    expect(row(w).units?.x).toMatchObject({
      status: "failed",
      lastError: "Reconnect the X account this post was made for.",
    });
    expect(w.net.count("POST", /\/tweets$/)).toBe(0);
  });

  test("a revoked token fails the unit, flips the connection to reconnect, and never retries by itself", async () => {
    const w = world();
    await connect(w, "threads");
    w.net.on("POST", /threads\.net\/v1\.0\/\d+\/threads$/, () => metaError(401, 190));
    const posted = await schedule(w, {
      networks: ["threads"],
      caption: "Revoked",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.threads).toMatchObject({
      status: "failed",
      lastError: "Threads access expired. Reconnect Threads.",
      nextAttemptAt: null,
    });
    expect(w.db.rows("social_provider_connections")[0]!["state"]).toBe("reconnect");
  });

  test("rate limits back off and give up after the attempt cap; media rejected fails at once", async () => {
    const w = world();
    await connect(w, "threads");
    w.net.on("POST", /threads\.net\/v1\.0\/\d+\/threads$/, () => metaError(429, 4));
    const posted = await schedule(w, {
      networks: ["threads"],
      caption: "Busy",
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(posted.units?.threads).toMatchObject({
      status: "scheduled",
      attempts: 1,
      lastError: "Threads is busy. Try again later.",
    });
    let attempts = 1;
    for (let i = 0; i < 6; i++) {
      w.tick(2 * 3600_000);
      const summary = await tickDuePosts(w.clock(), w.deps);
      attempts += summary.ran;
    }
    expect(row(w).units?.threads).toMatchObject({
      status: "failed",
      attempts: 5,
      nextAttemptAt: null,
    });
    expect(w.net.count("POST", /threads\.net\/v1\.0\/\d+\/threads$/)).toBe(5);
    w.net.on("POST", /threads\.net\/v1\.0\/\d+\/threads$/, () => metaError(400, 100, 2207004));
    const bad = await schedule(w, {
      id: OTHER,
      networks: ["threads"],
      caption: "Bad file",
      media: [photoItem()],
      runAt: new Date(w.clock()).toISOString(),
    });
    expect(bad.units?.threads).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Threads rejected the media file.",
    });
  });
});

describe("media lifecycle and sweeps", () => {
  test("tampered uploads never reach a provider; media is removed once every unit settled", async () => {
    const w = world();
    await connect(w, "threads");
    await connect(w, "x");
    const created = await createSchedule(
      OWNER,
      {
        id: GROUP,
        caption: "Both",
        networks: ["threads", "x"],
        runAt: new Date(w.clock()).toISOString(),
        media: [photoItem()],
      },
      w.deps,
    );
    w.db.upload(IMAGE_BUCKET, created.uploads[0]!.path, photo.subarray(0, photo.byteLength - 10));
    const ready = await readySchedule(OWNER, GROUP, w.deps);
    expect(ready.units?.threads?.lastError).toMatch(/does not match/);
    expect(ready.units?.x?.lastError).toMatch(/does not match/);
    expect(w.net.count("POST", /threads$|initialize/)).toBe(0);
    expect(w.db.removed).toEqual([`${IMAGE_BUCKET}/${OWNER}/social/${GROUP}/0.jpg`]);
    expect(ready.mediaRemovedAt).toBeDefined();
  });

  test("the sweep cancels posts whose media never arrived after a day", async () => {
    const w = world();
    await connect(w, "threads");
    await createSchedule(
      OWNER,
      {
        id: GROUP,
        caption: "Never uploaded",
        networks: ["threads"],
        runAt: new Date(w.clock()).toISOString(),
        media: [photoItem()],
      },
      w.deps,
    );
    w.tick(25 * 3600_000);
    expect(await sweepSchedule(w.deps)).toBe(1);
    expect(row(w).status).toBe("cancelled");
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 0 });
  });

  test("video verification reads ranges only; a mismatched declaration is refused", async () => {
    const w = world();
    await connect(w, "youtube");
    const clip = fixtureMp4({ durationMs: 30_000, mdatBytes: 2_000_000 });
    const wrong = await schedule(
      w,
      {
        networks: ["youtube-shorts"],
        caption: "d",
        title: "t",
        unitKind: "video",
        media: [{ ...videoItem(clip, 30_000), durationMs: 90_000 }],
        runAt: new Date(w.clock()).toISOString(),
      },
      { "0.mp4": clip },
    );
    expect(wrong.units?.["youtube-shorts"]?.lastError).toMatch(/does not match/);
    expect(w.net.count("POST", /uploadType=resumable/)).toBe(0);
    expect(w.db.objects.has(`${VIDEO_BUCKET}/${OWNER}/social/${GROUP}/0.mp4`)).toBe(false);
  });
});

describe("legacy records", () => {
  test("a version-1 scheduled row (no units) still runs on its runAt and keeps its result shape", async () => {
    const w = world();
    await connect(w, "threads");
    w.db.rows("social_publications").push({
      id: GROUP,
      owner_id: OWNER,
      record: {
        kind: "schedule",
        caption: "Old style",
        networks: ["threads"],
        runAt: new Date(w.clock() - 1000).toISOString(),
        status: "scheduled",
        results: [],
        createdAt: new Date(w.clock() - 60_000).toISOString(),
      },
      lease: null,
      lease_until: null,
      created_at: new Date(w.clock() - 60_000).toISOString(),
    });
    expect(await tickDuePosts(w.clock(), w.deps)).toMatchObject({ ran: 1, posted: 1 });
    const record = row(w);
    expect(record.status).toBe("posted");
    expect(record.results).toEqual([
      { id: "threads", ok: true, url: "https://www.threads.net/@sideline.threads/post/FIX" },
    ]);
  });
});
