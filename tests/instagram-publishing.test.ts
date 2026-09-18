import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FakeDatabase, FakeGraph, graphError } from "./instagram-fixtures";
import {
  INSTAGRAM_SCOPES,
  instagramAuthorizeUrl,
  finishInstagram,
  instagramSession,
  openToken,
  readShortToken,
  refreshDue,
  sealToken,
  stateHash,
  type InstagramSession,
} from "../src/lib/business/instagram.server";
import {
  CONTAINER_TIMEOUT_MS,
  advanceInstagramPost,
  createInstagramPost,
  discardInstagramPost,
  listInstagramPosts,
  sweepInstagramMedia,
  type InstagramPostDeps,
} from "../src/lib/business/instagram-post.server";
import {
  actOnInstagramComment,
  instagramMediaInsights,
  listInstagramComments,
  listInstagramMedia,
} from "../src/lib/business/instagram-manage.server";
import {
  captionProblem,
  instagramPostInput,
  sha256Hex,
  type InstagramPostInput,
  type InstagramPostRecord,
} from "../src/lib/social/instagram-post";
import { listPublications } from "../src/lib/business/publishing.server";
import { instantiateSocialWasm } from "../src/lib/social/wasm/engine";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "17841400000000001";
const KEY = Buffer.alloc(32, 9);
const DAY = 86_400_000;

/** Real feed JPEGs from the committed C++ engine, so verification reads real headers. */
let photos: Uint8Array[] = [];
beforeAll(async () => {
  const engine = await instantiateSocialWasm(
    readFileSync(new URL("../src/lib/social/wasm/celinen-social.wasm", import.meta.url)),
  );
  photos = [40, 120, 200].map((shade) => {
    const rgba = new Uint8ClampedArray(64 * 80 * 4).fill(shade);
    return engine.frame(rgba, 64, 80, { format: "portrait", x: 0.5, y: 0.5, zoom: 1 });
  });
});

function session(overrides: Partial<InstagramSession> = {}): InstagramSession {
  return {
    owner: OWNER,
    accountId: ACCOUNT,
    username: "sideline.studio",
    accountType: "MEDIA_CREATOR",
    scopes: [...INSTAGRAM_SCOPES],
    token: "fixture-token",
    expiresAt: new Date(Date.now() + 50 * DAY).toISOString(),
    ...overrides,
  };
}

function world() {
  const db = new FakeDatabase();
  const graph = new FakeGraph();
  let clock = Date.parse("2026-09-17T12:00:00Z");
  const sessions = new Map<string, InstagramSession>([[OWNER, session()]]);
  const deps: InstagramPostDeps = {
    db: db as never,
    fetch: graph.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    session: async (owner) => {
      const found = sessions.get(owner);
      if (!found) throw new Error("Connect Instagram first.");
      return found;
    },
  };
  return {
    db,
    graph,
    deps,
    sessions,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

async function input(count = 1, caption = "Friday lights #GameDay"): Promise<InstagramPostInput> {
  return {
    id: crypto.randomUUID(),
    source: "cull",
    format: "portrait",
    caption,
    items: await Promise.all(
      photos.slice(0, count).map(async (bytes) => ({
        sha256: await sha256Hex(bytes),
        bytes: bytes.byteLength,
        width: 1080,
        height: 1350,
      })),
    ),
  };
}

/** Create the draft and upload the confirmed bytes, as the composer does. */
async function drafted(w: ReturnType<typeof world>, count = 1, owner = OWNER) {
  const post = await input(count);
  const created = await createInstagramPost(owner, post, w.deps);
  created.uploads.forEach((ticket, index) => w.db.upload(ticket.path, photos[index]!));
  return { post, created };
}
const record = (w: ReturnType<typeof world>, id: string) =>
  w.db.rows("social_publications").find((row) => row.id === id)!.record as InstagramPostRecord;

describe("post input contract", () => {
  test("enforces Instagram's caption, carousel and feed-size limits", async () => {
    const valid = await input(2);
    expect(instagramPostInput.safeParse(valid).success).toBe(true);
    for (const patch of [
      { caption: "x".repeat(2201) },
      { caption: Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ") },
      { caption: Array.from({ length: 21 }, (_, i) => `@user${i}`).join(" ") },
      { items: [] },
      { items: Array.from({ length: 11 }, () => valid.items[0]!) },
      { items: [valid.items[0]!, valid.items[0]!] },
      { items: [{ ...valid.items[0]!, width: 1080, height: 1080 }] },
      { items: [{ ...valid.items[0]!, bytes: 9 * 1024 * 1024 }] },
    ])
      expect(instagramPostInput.safeParse({ ...valid, ...patch }).success).toBe(false);
    // Emoji count as one character each, as Instagram counts them.
    expect(captionProblem("🏈".repeat(2200))).toBeNull();
  });
});

describe("connect and token refresh", () => {
  beforeEach(() => {
    process.env["INSTAGRAM_APP_ID"] = "1234";
    process.env["INSTAGRAM_APP_SECRET"] = "app-secret";
    process.env["PUBLISH_ORIGIN"] = "https://lenslab.dev";
    process.env["SOCIAL_TOKEN_KEY"] = KEY.toString("hex");
  });

  test("authorize URL requests all four business scopes and forces account choice", () => {
    const url = new URL(
      instagramAuthorizeUrl("1234", "https://lenslab.dev/publish", "s".repeat(43)),
    );
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("scope")!.split(",")).toEqual([...INSTAGRAM_SCOPES]);
    expect(url.searchParams.get("force_reauth")).toBe("true");
    expect(url.searchParams.has("force_authentication")).toBe(false);
  });

  test("short-token responses are read in both documented and flat shapes", () => {
    expect(
      readShortToken({
        data: [
          {
            access_token: "a",
            user_id: 1,
            permissions: "instagram_business_basic,instagram_business_manage_comments",
          },
        ],
      }),
    ).toEqual({
      token: "a",
      scopes: ["instagram_business_basic", "instagram_business_manage_comments"],
    });
    expect(
      readShortToken({ access_token: "b", permissions: ["instagram_business_basic"] })?.scopes,
    ).toEqual(["instagram_business_basic"]);
    expect(readShortToken({ access_token: "c" })).toEqual({ token: "c", scopes: null });
    expect(readShortToken({ error: "x" })).toBeNull();
  });

  test("connect consumes the state once, stores only an owner-sealed long-lived token and granted scopes", async () => {
    const db = new FakeDatabase();
    const graph = new FakeGraph();
    const state = "a".repeat(43);
    db.rows("social_oauth_states").push({
      id: "s",
      hash: stateHash(state),
      owner_id: OWNER,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    } as never);
    graph
      .on("POST", /https:\/\/api\.instagram\.com\/oauth\/access_token/, (call) => {
        expect(call.body["code"]).toBe("CODE");
        expect(call.body["client_secret"]).toBe("app-secret");
        return {
          data: [
            {
              access_token: "short-token",
              user_id: ACCOUNT,
              permissions: INSTAGRAM_SCOPES.join(","),
            },
          ],
        };
      })
      .on("GET", /https:\/\/graph\.instagram\.com\/access_token\?/, () => ({
        access_token: "long-token",
        token_type: "bearer",
        expires_in: 5183944,
      }))
      .on("GET", /me\?fields=user_id,username,account_type/, (call) => {
        expect(call.auth).toBe("Bearer long-token");
        return { user_id: ACCOUNT, username: "sideline.studio", account_type: "BUSINESS" };
      });
    // Another owner cannot finish this owner's connection.
    await expect(
      finishInstagram(OTHER, "CODE", state, { db: db as never, fetch: graph.fetch }),
    ).rejects.toThrow("expired");
    await expect(
      finishInstagram(OWNER, "CODE#_", state, { db: db as never, fetch: graph.fetch }),
    ).resolves.toEqual({ username: "sideline.studio" });
    const row = db.rows("social_connections")[0]! as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain("long-token");
    expect(openToken(row["credential"] as string, OWNER, KEY)).toBe("long-token");
    expect(() => openToken(row["credential"] as string, OTHER, KEY)).toThrow();
    expect(row["scopes"]).toEqual([...INSTAGRAM_SCOPES]);
    expect(row["account_type"]).toBe("BUSINESS");
    // Replaying the same callback fails: the state was consumed.
    await expect(
      finishInstagram(OWNER, "CODE", state, { db: db as never, fetch: graph.fetch }),
    ).rejects.toThrow("already used");
  });

  test("refreshes a token that is due, keeps it owner-sealed, and never refreshes a fresh one", async () => {
    const db = new FakeDatabase();
    const graph = new FakeGraph();
    const now = Date.parse("2026-09-17T12:00:00Z");
    const credential = sealToken("old-token", OWNER, KEY);
    db.rows("social_connections").push({
      id: "c",
      owner_id: OWNER,
      account_id: ACCOUNT,
      username: "sideline.studio",
      credential,
      expires_at: new Date(now + 30 * DAY).toISOString(),
      scopes: [...INSTAGRAM_SCOPES],
      token_refreshed_at: new Date(now - 30 * DAY).toISOString(),
    });
    graph.on("GET", /refresh_access_token/, (call) => {
      expect(call.path).toContain("grant_type=ig_refresh_token");
      return { access_token: "new-token", token_type: "bearer", expires_in: 5183944 };
    });
    const refreshed = await instagramSession(OWNER, {
      db: db as never,
      fetch: graph.fetch,
      now: () => now,
      key: KEY,
    });
    expect(refreshed.token).toBe("new-token");
    const row = db.rows("social_connections")[0]! as Record<string, unknown>;
    expect(openToken(row["credential"] as string, OWNER, KEY)).toBe("new-token");
    expect(Date.parse(row["expires_at"] as string)).toBeGreaterThan(now + 59 * DAY);
    // Now fresh: a second session does not call Instagram again.
    await instagramSession(OWNER, {
      db: db as never,
      fetch: graph.fetch,
      now: () => now + 1000,
      key: KEY,
    });
    expect(graph.count("GET", /refresh_access_token/)).toBe(1);
    expect(
      refreshDue(
        { ...(row as never), token_refreshed_at: new Date(now - 3600000).toISOString() },
        now,
      ),
    ).toBe(false);
  });

  test("a failed refresh keeps the still-valid token; an expired connection asks to reconnect", async () => {
    const db = new FakeDatabase();
    const graph = new FakeGraph();
    const now = Date.now();
    db.rows("social_connections").push({
      id: "c",
      owner_id: OWNER,
      account_id: ACCOUNT,
      username: "sideline.studio",
      credential: sealToken("old-token", OWNER, KEY),
      expires_at: new Date(now + 10 * DAY).toISOString(),
      token_refreshed_at: new Date(now - 50 * DAY).toISOString(),
    });
    graph.on("GET", /refresh_access_token/, () => graphError(400, 190));
    const kept = await instagramSession(OWNER, { db: db as never, fetch: graph.fetch, key: KEY });
    expect(kept.token).toBe("old-token");
    // Pre-migration rows read as the original two publishing scopes.
    expect(kept.scopes).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
    (db.rows("social_connections")[0] as Record<string, unknown>)["expires_at"] = new Date(
      now - 1000,
    ).toISOString();
    await expect(
      instagramSession(OWNER, { db: db as never, fetch: graph.fetch, key: KEY }),
    ).rejects.toThrow("Reconnect");
    await expect(
      instagramSession(OTHER, { db: db as never, fetch: graph.fetch, key: KEY }),
    ).rejects.toThrow("Connect Instagram first");
  });
});

describe("publishing a single photo", () => {
  test("verifies the uploaded bytes, creates a captioned container, publishes once and removes the media", async () => {
    const w = world();
    const { post, created } = await drafted(w);
    expect(created.uploads).toHaveLength(1);
    expect(created.uploads[0]!.path).toBe(`${OWNER}/${post.id}/0.jpg`);
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("published");
    expect(view.permalink).toBe("https://www.instagram.com/p/FIXTURE/");
    const container = w.graph.calls.find(
      (call) => call.method === "POST" && call.path === `${ACCOUNT}/media`,
    )!;
    expect(container.body["caption"]).toBe("Friday lights #GameDay");
    expect(container.body["is_carousel_item"]).toBeUndefined();
    expect(container.body["image_url"]).toContain(
      `/sign/publishing-media-v1/${OWNER}/${post.id}/0.jpg`,
    );
    expect(container.body["image_url"]).toContain("expires=900");
    expect(container.auth).toBe("Bearer fixture-token");
    expect(w.graph.count("POST", /media_publish$/)).toBe(1);
    expect(w.db.objects.size).toBe(0);
    expect(record(w, post.id).mediaRemovedAt).toBeString();
    expect(record(w, post.id).mediaId).toBe("17900000000000001");
    // A repeat request is a no-op.
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("published");
    expect(w.graph.count("POST", /media_publish$/)).toBe(1);
    expect(await listInstagramPosts(OWNER, w.deps)).toHaveLength(1);
    // Delivery publishing lists never see Studio posts.
    const legacy = await listPublications(OWNER).catch(() => null);
    expect(legacy === null || legacy.every((row) => !("kind" in row))).toBe(true);
  });

  test("tampered or missing uploads are never given to Instagram", async () => {
    const w = world();
    const { post } = await input(1).then(async (value) => ({
      post: value,
      created: await createInstagramPost(OWNER, value, w.deps),
    }));
    let view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("awaiting-upload");
    expect(view.note).toContain("uploading");
    const altered = photos[0]!.slice();
    altered[altered.length - 3] ^= 0xff;
    w.db.upload(`${OWNER}/${post.id}/0.jpg`, altered);
    view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.note).toContain("does not match");
    expect(w.graph.calls).toHaveLength(0);
    // Retrying with the same id re-issues upload tickets; correct bytes then post.
    const again = await createInstagramPost(OWNER, post, w.deps);
    expect(again.uploads).toHaveLength(1);
    w.db.upload(again.uploads[0]!.path, photos[0]!);
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("published");
  });
});

describe("publishing a carousel", () => {
  test("children, then one CAROUSEL container with the caption, then one publish", async () => {
    const w = world();
    const { post } = await drafted(w, 3);
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("published");
    expect(view.photos).toBe(3);
    const creates = w.graph.calls.filter(
      (call) => call.method === "POST" && call.path === `${ACCOUNT}/media`,
    );
    expect(creates).toHaveLength(4);
    expect(
      creates
        .slice(0, 3)
        .every((call) => call.body["is_carousel_item"] === "true" && !call.body["caption"]),
    ).toBe(true);
    const children = record(w, post.id).children!;
    expect(creates[3]!.body).toEqual({
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: post.caption,
    });
    const publish = w.graph.calls.find((call) => call.path.endsWith("media_publish"))!;
    expect(publish.body["creation_id"]).toBe(record(w, post.id).containerId!);
    // Order is the composer's order.
    expect(
      creates.slice(0, 3).map((call) => call.body["image_url"]!.match(/\/(\d)\.jpg/)![1]),
    ).toEqual(["0", "1", "2"]);
    expect(w.db.objects.size).toBe(0);
  });

  test("a failure mid-way resumes without recreating finished children", async () => {
    const w = world();
    const { post } = await drafted(w, 3);
    let creates = 0;
    w.graph.on("POST", /\d+\/media$/, () =>
      ++creates === 2 ? graphError(500, 1) : { id: String(5000 + creates) },
    );
    const first = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(first.status).toBe("failed");
    expect(record(w, post.id).children).toEqual(["5001"]);
    const second = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(second.status).toBe("published");
    expect(record(w, post.id).children).toEqual(["5001", "5003", "5004"]);
  });
});

describe("container processing, errors and timeout", () => {
  test("a slow container hands back to the page, then finishes on the next step", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.status("1000", ...Array(8).fill("IN_PROGRESS"), "FINISHED");
    const first = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(first.status).toBe("processing");
    expect(w.graph.count("POST", /media_publish$/)).toBe(0);
    const second = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(second.status).toBe("published");
    expect(w.graph.count("POST", /\d+\/media$/)).toBe(1); // the container was reused
  });

  test("an ERROR container fails cleanly and a retry creates a new one", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.status("1000", "ERROR");
    const failed = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(failed.status).toBe("failed");
    expect(failed.note).toContain("could not process");
    expect(record(w, post.id).containerId).toBeUndefined();
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("published");
    expect(w.graph.count("POST", /\d+\/media$/)).toBe(2);
    expect(w.graph.count("POST", /media_publish$/)).toBe(1);
  });

  test("a container still processing after five minutes times out without publishing", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.status("1000", "IN_PROGRESS");
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("processing");
    w.tick(CONTAINER_TIMEOUT_MS);
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("failed");
    expect(view.note).toContain("too long");
    expect(w.graph.count("POST", /media_publish$/)).toBe(0);
  });
});

describe("duplicate-retry idempotency", () => {
  test("the same post id is one post; different content under that id is refused", async () => {
    const w = world();
    const post = await input(2);
    const a = await createInstagramPost(OWNER, post, w.deps);
    const b = await createInstagramPost(OWNER, post, w.deps);
    expect(b.post.id).toBe(a.post.id);
    expect(w.db.rows("social_publications")).toHaveLength(1);
    await expect(
      createInstagramPost(OWNER, { ...post, caption: "changed" }, w.deps),
    ).rejects.toThrow("different");
  });

  test("a lost media_publish answer is never re-sent; the container status reconciles it", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.on("POST", /media_publish$/, () => new TypeError("socket hang up"));
    const lost = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(lost.status).toBe("uncertain");
    expect(await advanceInstagramPost(OWNER, post.id, w.deps).then((v) => v.status)).toBe(
      "uncertain",
    );
    await expect(discardInstagramPost(OWNER, post.id, w.deps)).rejects.toThrow(
      "may be on Instagram",
    );
    expect(w.graph.count("POST", /media_publish$/)).toBe(1);
    w.graph.status(record(w, post.id).containerId!, "PUBLISHED");
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("published");
    expect(w.graph.count("POST", /media_publish$/)).toBe(1);
    expect(w.db.objects.size).toBe(0);
  });

  test("a crash after the publishing intent was saved is treated as uncertain", async () => {
    const w = world();
    const { post } = await drafted(w);
    await advanceInstagramPost(OWNER, post.id, w.deps);
    const row = w.db.rows("social_publications")[0]!;
    const crashed = structuredClone(row.record as InstagramPostRecord);
    crashed.status = "publishing";
    crashed.containerId = "1000";
    delete crashed.mediaId;
    row.record = crashed;
    w.graph.status("1000", "FINISHED");
    const before = w.graph.count("POST", /media_publish$/);
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("uncertain");
    expect(w.graph.count("POST", /media_publish$/)).toBe(before);
  });

  test("concurrent steps (double click, second tab) hold at most one lease", async () => {
    const w = world();
    const { post } = await drafted(w);
    const results = await Promise.allSettled([
      advanceInstagramPost(OWNER, post.id, w.deps),
      advanceInstagramPost(OWNER, post.id, w.deps),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(w.graph.count("POST", /media_publish$/)).toBe(1);
  });
});

describe("rate limits", () => {
  test("a used-up publishing quota fails before any container exists", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.quota = { used: 100, total: 100 };
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("failed");
    expect(view.note).toBe(
      "Instagram allows 100 app posts per 24 hours and this account has used them. Try again later.",
    );
    expect(w.graph.count("POST", /\d+\/media$/)).toBe(0);
  });

  test("a publish-limit refusal at media_publish is definitive: failed, not uncertain, retryable", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.on("POST", /media_publish$/, () => graphError(400, 9, 2207042));
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("failed");
    expect(view.note).toContain("daily publishing limit");
    expect(view.note).not.toContain("upstream");
    w.graph.on("POST", /media_publish$/, () => ({ id: "17900000000000002" }));
    expect((await advanceInstagramPost(OWNER, post.id, w.deps)).status).toBe("published");
  });

  test("app rate limiting while creating containers is reported plainly", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.graph.on("POST", /\d+\/media$/, () => graphError(400, 4));
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("failed");
    expect(view.note).toBe("Instagram is busy. Try again later.");
  });
});

describe("storage cleanup", () => {
  test("discard removes uploaded photos; stale drafts are swept after 24 hours", async () => {
    const w = world();
    const { post } = await drafted(w, 2);
    expect(w.db.objects.size).toBe(2);
    expect((await discardInstagramPost(OWNER, post.id, w.deps)).status).toBe("discarded");
    expect(w.db.objects.size).toBe(0);
    expect(await listInstagramPosts(OWNER, w.deps)).toHaveLength(0);

    const stale = await drafted(w, 1);
    const row = w.db.rows("social_publications").find((r) => r.id === stale.post.id)!;
    row["created_at"] = new Date(Date.parse("2026-09-15T00:00:00Z")).toISOString();
    expect(await sweepInstagramMedia(OWNER, w.deps)).toBe(1);
    expect(w.db.objects.size).toBe(0);
    expect(record(w, stale.post.id).status).toBe("expired");
  });
});

describe("authorization", () => {
  test("another owner cannot read, advance, discard or overwrite a post", async () => {
    const w = world();
    w.sessions.set(
      OTHER,
      session({ owner: OTHER, accountId: "17841400000000999", username: "other" }),
    );
    const { post } = await drafted(w);
    await expect(advanceInstagramPost(OTHER, post.id, w.deps)).rejects.toThrow("unavailable");
    await expect(discardInstagramPost(OTHER, post.id, w.deps)).rejects.toThrow("unavailable");
    await expect(createInstagramPost(OTHER, post, w.deps)).rejects.toThrow("Could not save");
    expect(await listInstagramPosts(OTHER, w.deps)).toHaveLength(0);
    expect(w.graph.calls).toHaveLength(0);
    expect(record(w, post.id).status).toBe("awaiting-upload");
  });

  test("a post confirmed for one Instagram account is never sent to a different connected account", async () => {
    const w = world();
    const { post } = await drafted(w);
    w.sessions.set(OWNER, session({ accountId: "17841400000000777", username: "switched" }));
    const view = await advanceInstagramPost(OWNER, post.id, w.deps);
    expect(view.status).toBe("failed");
    expect(view.note).toBe("Reconnect @sideline.studio to post this.");
    expect(w.graph.calls).toHaveLength(0);
  });

  test("posting requires the content publishing scope", async () => {
    const w = world();
    w.sessions.set(OWNER, session({ scopes: ["instagram_business_basic"] }));
    await expect(createInstagramPost(OWNER, await input(1), w.deps)).rejects.toThrow(
      "Reconnect Instagram and allow posting",
    );
  });
});

describe("account management", () => {
  const MEDIA = "17900000000000010";
  const COMMENT = "17800000000000020";
  function manage() {
    const graph = new FakeGraph();
    const sessions = new Map([[OWNER, session()]]);
    graph
      .on("GET", new RegExp(`${ACCOUNT}/media\\?fields=`), (call) => {
        expect(call.path).toContain("limit=24");
        return {
          data: [
            {
              id: MEDIA,
              caption: "Senior night",
              media_type: "CAROUSEL_ALBUM",
              media_product_type: "FEED",
              media_url: "https://scontent.cdninstagram.com/a.jpg",
              permalink: "https://www.instagram.com/p/A/",
              timestamp: "2026-09-16T01:00:00+0000",
              like_count: 120,
              comments_count: 4,
            },
            { id: "not-a-number", caption: "dropped" },
          ],
          paging: {
            cursors: { after: "QVFIUmFfdGVzdA" },
            next: "https://graph.instagram.com/next",
          },
        };
      })
      .on("GET", /\d+\?fields=id,username$/, (call) => ({
        id: call.path.split("?")[0],
        username: "someone.else",
      }))
      .on("GET", new RegExp(`${MEDIA}\\?fields=id,username$`), () => ({
        id: MEDIA,
        username: "sideline.studio",
      }))
      .on("GET", new RegExp(`${COMMENT}\\?fields=id,media,parent_id,hidden$`), () => ({
        id: COMMENT,
        media: { id: MEDIA },
        hidden: false,
      }))
      .on("GET", new RegExp(`${MEDIA}/comments\\?`), () => ({
        data: [
          {
            id: COMMENT,
            text: "Great shot",
            username: "fan",
            timestamp: "t",
            hidden: false,
            like_count: 2,
            replies: {
              data: [
                {
                  id: "17800000000000021",
                  text: "Thanks",
                  username: "sideline.studio",
                  timestamp: "t",
                },
              ],
            },
          },
        ],
      }))
      .on("POST", new RegExp(`${COMMENT}/replies$`), () => ({ id: "17800000000000030" }))
      .on("POST", new RegExp(`${COMMENT}\\?hide=(true|false)$`), () => ({ success: true }))
      .on("DELETE", new RegExp(`${COMMENT}$`), () => ({ success: true }))
      .on("GET", new RegExp(`${MEDIA}/insights\\?metric=`), () => ({
        data: [
          { name: "reach", period: "lifetime", values: [{ value: 2400 }] },
          { name: "likes", period: "lifetime", values: [{ value: 120 }] },
          { name: "comments", period: "lifetime", values: [{ value: 4 }] },
          { name: "saved", period: "lifetime", values: [{ value: 31 }] },
          { name: "shares", total_value: { value: 9 } },
          { name: "impressions", values: [{ value: 1 }] },
        ],
      }));
    const deps = {
      fetch: graph.fetch,
      session: async (owner: string) =>
        sessions.get(owner) ?? Promise.reject(new Error("Connect Instagram first.")),
    };
    return { graph, deps, sessions };
  }

  test("lists own media with a validated next cursor", async () => {
    const { deps } = manage();
    const page = await listInstagramMedia(OWNER, null, deps);
    expect(page.media).toHaveLength(1);
    expect(page.media[0]).toMatchObject({
      id: MEDIA,
      likes: 120,
      comments: 4,
      image: "https://scontent.cdninstagram.com/a.jpg",
    });
    expect(page.next).toBe("QVFIUmFfdGVzdA");
    await expect(listInstagramMedia(OWNER, "bad cursor&x=1", deps)).rejects.toThrow();
    await expect(listInstagramMedia(OTHER, null, deps)).rejects.toThrow("Connect Instagram first");
  });

  test("reads comments with replies; reply, hide and delete reach only the verified comment", async () => {
    const { graph, deps } = manage();
    const listed = await listInstagramComments(OWNER, MEDIA, null, deps);
    expect(listed.comments[0]!.replies[0]!.text).toBe("Thanks");
    expect(
      await actOnInstagramComment(
        OWNER,
        { action: "reply", mediaId: MEDIA, commentId: COMMENT, message: "Thank you!" },
        deps,
      ),
    ).toEqual({ ok: true, id: "17800000000000030" });
    expect(graph.calls.find((c) => c.path.endsWith("/replies"))!.body).toEqual({
      message: "Thank you!",
    });
    await actOnInstagramComment(
      OWNER,
      { action: "hide", mediaId: MEDIA, commentId: COMMENT, hidden: true },
      deps,
    );
    await actOnInstagramComment(
      OWNER,
      { action: "delete", mediaId: MEDIA, commentId: COMMENT },
      deps,
    );
    expect(graph.count("DELETE", new RegExp(COMMENT))).toBe(1);
  });

  test("refuses hidden-comment replies, foreign media and comments from other posts before any write", async () => {
    const { graph, deps } = manage();
    graph.on("GET", new RegExp(`${COMMENT}\\?fields=`), () => ({
      id: COMMENT,
      media: { id: MEDIA },
      hidden: true,
    }));
    await expect(
      actOnInstagramComment(
        OWNER,
        { action: "reply", mediaId: MEDIA, commentId: COMMENT, message: "hi" },
        deps,
      ),
    ).rejects.toThrow("Unhide");
    await expect(
      actOnInstagramComment(
        OWNER,
        { action: "delete", mediaId: "17900000000000099", commentId: COMMENT },
        deps,
      ),
    ).rejects.toThrow("not on your connected");
    graph.on("GET", new RegExp(`${COMMENT}\\?fields=`), () => ({
      id: COMMENT,
      media: { id: "17900000000000011" },
    }));
    await expect(
      actOnInstagramComment(OWNER, { action: "delete", mediaId: MEDIA, commentId: COMMENT }, deps),
    ).rejects.toThrow("not on that post");
    expect(graph.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  test("insights read reach, likes, comments, saves and shares only", async () => {
    const { deps, sessions, graph } = manage();
    expect(await instagramMediaInsights(OWNER, MEDIA, deps)).toEqual({
      reach: 2400,
      likes: 120,
      comments: 4,
      saved: 31,
      shares: 9,
    });
    sessions.set(
      OWNER,
      session({ scopes: ["instagram_business_basic", "instagram_business_content_publish"] }),
    );
    const before = graph.calls.length;
    await expect(instagramMediaInsights(OWNER, MEDIA, deps)).rejects.toThrow(
      "Reconnect Instagram and allow insights",
    );
    await expect(listInstagramComments(OWNER, MEDIA, null, deps)).rejects.toThrow(
      "allow comment management",
    );
    expect(graph.calls.length).toBe(before);
  });
});
