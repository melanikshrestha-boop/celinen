/** Broadcasting one hearted set to every story destination at once.
 *
 * The rule every test here defends: a photo that may already be on a platform is
 * never sent to it again. Everything else — partial failure, reconnect, retry —
 * is allowed to be messy, as long as nothing double-posts.
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FakeDatabase, FakeSocialGraph, facebookError, graphError } from "./story-fixtures";
import { INSTAGRAM_SCOPES, type InstagramSession } from "../src/lib/business/instagram.server";
import type { FacebookPageSession } from "../src/lib/business/facebook.server";
import {
  advanceStoryBroadcast,
  createStoryBroadcast,
  discardStoryBroadcast,
  listStoryBroadcasts,
  reconcileStoryBroadcast,
  sweepStoryMedia,
  type StoryBroadcastDeps,
} from "../src/lib/business/story-broadcast.server";
import {
  STORY_FORMAT,
  rollUpDestination,
  sha256Hex,
  storyBroadcastInput,
  unitSendable,
  type StoryBroadcastRecord,
  type StoryUnit,
} from "../src/lib/social/story-broadcast";
import { instantiateSocialWasm } from "../src/lib/social/wasm/engine";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "17841400000000001";
const PAGE = "20000000000000001";
const DAY = 86_400_000;

/** Real 9:16 JPEGs from the committed C++ engine, so verification reads real headers. */
let stories: Uint8Array[] = [];
beforeAll(async () => {
  const engine = await instantiateSocialWasm(
    readFileSync(new URL("../src/lib/social/wasm/celinen-social.wasm", import.meta.url)),
  );
  stories = [40, 120, 200].map((shade) => {
    const rgba = new Uint8ClampedArray(64 * 80 * 4).fill(shade);
    return engine.frame(rgba, 64, 80, { format: "story", x: 0.5, y: 0.5, zoom: 1 });
  });
});

const instagramSession = (overrides: Partial<InstagramSession> = {}): InstagramSession => ({
  owner: OWNER,
  accountId: ACCOUNT,
  username: "sideline.studio",
  accountType: "BUSINESS",
  scopes: [...INSTAGRAM_SCOPES],
  token: "fixture-instagram-token",
  expiresAt: new Date(Date.now() + 50 * DAY).toISOString(),
  ...overrides,
});
const pageSession = (overrides: Partial<FacebookPageSession> = {}): FacebookPageSession => ({
  pageId: PAGE,
  pageName: "Sideline Studio",
  token: "fixture-page-token",
  ...overrides,
});

function world() {
  const db = new FakeDatabase();
  const graph = new FakeSocialGraph();
  let clock = Date.parse("2026-09-18T12:00:00Z");
  // Rows age on the test's clock, not the wall clock, or the sweep's "older
  // than a day" depends on what time of day the suite runs.
  db.now = () => clock;
  let instagram: InstagramSession | Error = instagramSession();
  let facebook: FacebookPageSession | Error = pageSession();
  const deps: StoryBroadcastDeps = {
    db: db as never,
    fetch: graph.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    instagram: async () => {
      if (instagram instanceof Error) throw instagram;
      return instagram;
    },
    facebook: async () => {
      if (facebook instanceof Error) throw facebook;
      return facebook;
    },
  };
  return {
    db,
    graph,
    deps,
    tick: (ms: number) => (clock += ms),
    at: () => clock,
    setInstagram: (next: InstagramSession | Error) => (instagram = next),
    setFacebook: (next: FacebookPageSession | Error) => (facebook = next),
    record: (id: string) =>
      db.rows("social_publications").find((row) => row.id === id)?.["record"] as
        StoryBroadcastRecord | undefined,
  };
}

async function input(
  count = 2,
  destinations: ("instagram-story" | "facebook-story")[] = ["instagram-story", "facebook-story"],
) {
  const items = await Promise.all(
    stories.slice(0, count).map(async (bytes) => ({
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
      width: STORY_FORMAT.width,
      height: STORY_FORMAT.height,
    })),
  );
  return {
    id: crypto.randomUUID(),
    source: "develop" as const,
    destinations,
    items,
  };
}

/** Saves the set and puts the exact confirmed bytes in the bucket. */
async function ready(
  stage: ReturnType<typeof world>,
  count = 2,
  destinations: ("instagram-story" | "facebook-story")[] = ["instagram-story", "facebook-story"],
) {
  const data = await input(count, destinations);
  const created = await createStoryBroadcast(OWNER, data, stage.deps);
  for (const [index, ticket] of created.uploads.entries())
    stage.db.upload(ticket.path, stories[index]!);
  return { data, created };
}

describe("The story set contract", () => {
  test("a set is one to twenty photos, each already framed to 9:16", async () => {
    const data = await input(2);
    expect(storyBroadcastInput.safeParse(data).success).toBe(true);
    expect(storyBroadcastInput.safeParse({ ...data, items: [] }).success).toBe(false);
    // A feed-shaped photo is not a story and must not reach a platform as one.
    expect(
      storyBroadcastInput.safeParse({
        ...data,
        items: [{ ...data.items[0]!, width: 1080, height: 1350 }],
      }).success,
    ).toBe(false);
    expect(storyBroadcastInput.safeParse({ ...data, destinations: [] }).success).toBe(false);
    expect(storyBroadcastInput.safeParse({ ...data, destinations: ["snapchat"] }).success).toBe(
      false,
    );
  });

  test("the same photo cannot be in the set twice, and neither can a destination", async () => {
    const data = await input(2);
    expect(
      storyBroadcastInput.safeParse({ ...data, items: [data.items[0]!, data.items[0]!] }).success,
    ).toBe(false);
    expect(
      storyBroadcastInput.safeParse({
        ...data,
        destinations: ["instagram-story", "instagram-story"],
      }).success,
    ).toBe(false);
  });

  test("a destination reads as the photos underneath it, never better", () => {
    const unit = (status: StoryUnit["status"]): StoryUnit => ({ status, note: "" });
    expect(rollUpDestination([unit("posted"), unit("posted")])).toBe("posted");
    expect(rollUpDestination([unit("posted"), unit("failed")])).toBe("partial");
    expect(rollUpDestination([unit("failed"), unit("failed")])).toBe("failed");
    expect(rollUpDestination([unit("uncertain"), unit("failed")])).toBe("uncertain");
    expect(rollUpDestination([unit("posted"), unit("uncertain")])).toBe("partial");
    expect(rollUpDestination([unit("posted"), unit("pending")])).toBe("working");
    expect(rollUpDestination([])).toBe("pending");
  });

  test("only photos that provably never left are sendable again", () => {
    const sendable: StoryUnit["status"][] = ["pending", "preparing", "processing", "failed"];
    const never: StoryUnit["status"][] = ["publishing", "posted", "uncertain"];
    for (const status of sendable) expect(unitSendable({ status, note: "" })).toBe(true);
    for (const status of never) expect(unitSendable({ status, note: "" })).toBe(false);
  });
});

describe("Posting a set to both platforms", () => {
  let stage: ReturnType<typeof world>;
  beforeEach(() => {
    stage = world();
  });

  test("every photo reaches Instagram as a story and Facebook as a photo story", async () => {
    const { data } = await ready(stage, 2);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    expect(view.status).toBe("done");
    expect(view.destinations.map((line) => [line.destination, line.status, line.posted])).toEqual([
      ["instagram-story", "posted", 2],
      ["facebook-story", "posted", 2],
    ]);

    // Instagram: media_type=STORIES with an image_url, then media_publish. No
    // caption, no carousel, and one container per photo.
    const containers = stage.graph.calls.filter(
      (call) => call.method === "POST" && call.path === `${ACCOUNT}/media`,
    );
    expect(containers).toHaveLength(2);
    for (const call of containers) {
      expect(call.body["media_type"]).toBe("STORIES");
      expect(call.body["image_url"]).toMatch(/^https:\/\/fixture\.supabase\.co\//);
      expect(call.body).not.toHaveProperty("caption");
      expect(call.body).not.toHaveProperty("children");
      expect(call.body).not.toHaveProperty("is_carousel_item");
    }
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(2);

    // Facebook: an unpublished photo, then a photo story made from it.
    const photos = stage.graph.calls.filter(
      (call) => call.method === "POST" && call.path === `fb:${PAGE}/photos`,
    );
    expect(photos).toHaveLength(2);
    for (const call of photos) {
      expect(call.body["published"]).toBe("false");
      expect(call.body["url"]).toMatch(/^https:\/\/fixture\.supabase\.co\//);
    }
    const madeStories = stage.graph.calls.filter(
      (call) => call.method === "POST" && call.path === `fb:${PAGE}/photo_stories`,
    );
    expect(madeStories).toHaveLength(2);
    expect(madeStories.map((call) => call.body["photo_id"])).toEqual(stage.graph.photoIds);

    // Every photo gets its own Facebook upload: a photo already used in a post
    // cannot become a story.
    expect(new Set(stage.graph.photoIds).size).toBe(2);

    // The tokens are the right ones, and neither is ever in a URL.
    for (const call of stage.graph.calls)
      expect(call.auth).toBe(
        call.path.startsWith("fb:")
          ? "Bearer fixture-page-token"
          : "Bearer fixture-instagram-token",
      );

    // The uploaded photos are gone once nothing can still need them.
    expect(stage.record(data.id)!.mediaRemovedAt).toBeTruthy();
    expect(stage.db.removed).toHaveLength(2);
  });

  test("the photos a platform fetches are the bytes that were confirmed", async () => {
    const data = await input(1);
    const created = await createStoryBroadcast(OWNER, data, stage.deps);
    // A different photo uploaded under the confirmed path is refused.
    stage.db.upload(created.uploads[0]!.path, stories[1]!);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.status).toBe("awaiting-upload");
    expect(view.note).toMatch(/does not match/i);
    // Nothing was sent anywhere.
    expect(stage.graph.calls).toHaveLength(0);
  });

  test("a set is never posted twice, however many times the page asks", async () => {
    const { data } = await ready(stage, 2);
    await Promise.all([
      advanceStoryBroadcast(OWNER, data.id, stage.deps),
      advanceStoryBroadcast(OWNER, data.id, stage.deps).catch(() => null),
    ]);
    for (let i = 0; i < 3; i++) await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(2);
    expect(stage.graph.count("POST", /^fb:\d+\/photo_stories$/)).toBe(2);
  });

  test("creating the same set again resumes it rather than starting a second one", async () => {
    const { data } = await ready(stage, 2);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    const again = await createStoryBroadcast(OWNER, data, stage.deps);
    expect(again.broadcast.status).toBe("done");
    expect(again.uploads).toHaveLength(0);
    expect(stage.db.rows("social_publications")).toHaveLength(1);
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(2);
  });

  test("the same id with different photos is refused instead of overwriting the set", async () => {
    const { data } = await ready(stage, 2);
    const other = await input(1);
    await expect(
      createStoryBroadcast(OWNER, { ...other, id: data.id }, stage.deps),
    ).rejects.toThrow(/different photos/i);
  });
});

describe("When one destination fails and the other does not", () => {
  let stage: ReturnType<typeof world>;
  beforeEach(() => {
    stage = world();
  });

  test("Instagram failing leaves Facebook posted, and the set says so", async () => {
    stage.graph.on("POST", /\d+\/media$/, () => graphError(400, 100, 2207052));
    const { data } = await ready(stage, 2);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    const [instagram, facebook] = view.destinations;
    expect(instagram!.status).toBe("failed");
    expect(instagram!.posted).toBe(0);
    expect(facebook!.status).toBe("posted");
    expect(facebook!.posted).toBe(2);
    expect(view.status).toBe("done");
    // The message is Celinen's own words, never the upstream text.
    expect(instagram!.note).not.toMatch(/secrets/);
  });

  test("a photo Facebook refuses leaves the rest of the set posted", async () => {
    let seen = 0;
    stage.graph.on("POST", /fb:\d+\/photo_stories$/, () =>
      ++seen === 1 ? facebookError(400, 506) : { success: true, post_id: `${PAGE}_1` },
    );
    const { data } = await ready(stage, 2);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    const facebook = view.destinations.find((line) => line.destination === "facebook-story")!;
    expect(facebook.status).toBe("partial");
    expect(facebook.posted).toBe(1);
    expect(view.destinations[0]!.status).toBe("posted");
  });

  test("retrying re-sends only the photos that never left", async () => {
    let fail = true;
    stage.graph.on("POST", /fb:\d+\/photo_stories$/, (call) =>
      fail && call.body["photo_id"] === stage.graph.photoIds[1]
        ? facebookError(500, 1)
        : { success: true, post_id: `${PAGE}_${stage.graph.nextStory++}` },
    );
    const { data } = await ready(stage, 2);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    const before = stage.record(data.id)!.destinations["facebook-story"]!;
    // A 500 is not a definitive refusal, so that photo is uncertain and is done with.
    expect(before.units.map((unit) => unit.status)).toEqual(["posted", "uncertain"]);

    fail = false;
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    // Neither photo goes again: one is posted, the other may be.
    expect(stage.graph.count("POST", /^fb:\d+\/photo_stories$/)).toBe(2);
    expect(stage.record(data.id)!.destinations["facebook-story"]!.status).toBe("partial");
  });

  test("a clean refusal is safe to retry, and the retry posts it", async () => {
    let refuse = true;
    stage.graph.on("POST", /fb:\d+\/photos$/, () => {
      if (refuse) return facebookError(400, 324);
      const id = String(stage.graph.nextPhoto++);
      stage.graph.photoIds.push(id);
      return { id };
    });
    const { data } = await ready(stage, 1, ["facebook-story"]);
    const first = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(first.destinations[0]!.status).toBe("failed");
    expect(stage.graph.count("POST", /^fb:\d+\/photo_stories$/)).toBe(0);

    refuse = false;
    const second = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(second.destinations[0]!.status).toBe("posted");
    expect(stage.graph.count("POST", /^fb:\d+\/photo_stories$/)).toBe(1);
  });

  test("an expired connection is a reconnect, and the photos stay unsent", async () => {
    const { data } = await ready(stage, 2, ["facebook-story"]);
    // The connection lapses between confirming the set and posting it.
    stage.setFacebook(new Error("Facebook access expired. Reconnect Facebook."));
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    expect(view.destinations[0]!.status).toBe("needs-reconnect");
    expect(view.destinations[0]!.note).toMatch(/reconnect/i);
    expect(stage.graph.calls).toHaveLength(0);
    expect(stage.record(data.id)!.destinations["facebook-story"]!.units.every(unitSendable)).toBe(
      true,
    );

    // Reconnecting and asking again posts them.
    stage.setFacebook(pageSession());
    const after = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(after.destinations[0]!.status).toBe("posted");
  });

  test("a different Instagram account than the one confirmed is never posted to", async () => {
    const { data } = await ready(stage, 1, ["instagram-story"]);
    stage.setInstagram(instagramSession({ accountId: "17841499999999999", username: "other" }));
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.destinations[0]!.status).toBe("needs-reconnect");
    expect(view.destinations[0]!.note).toMatch(/@sideline\.studio/);
    expect(stage.graph.calls).toHaveLength(0);
  });

  test("a different Facebook Page than the one confirmed is never posted to", async () => {
    const { data } = await ready(stage, 1, ["facebook-story"]);
    stage.setFacebook(pageSession({ pageId: "20000000000000009", pageName: "Another Page" }));
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.destinations[0]!.status).toBe("needs-reconnect");
    expect(view.destinations[0]!.note).toMatch(/Sideline Studio/);
    expect(stage.graph.calls).toHaveLength(0);
  });

  test("posting needs the Instagram publishing permission, checked before the set is saved", async () => {
    stage.setInstagram(instagramSession({ scopes: ["instagram_business_basic"] }));
    await expect(
      createStoryBroadcast(OWNER, await input(1, ["instagram-story"]), stage.deps),
    ).rejects.toThrow(/allow posting/i);
    expect(stage.db.rows("social_publications")).toHaveLength(0);
  });

  test("a permission lost after the set was saved is a reconnect, not a failed post", async () => {
    const { data } = await ready(stage, 1, ["instagram-story"]);
    stage.setInstagram(instagramSession({ scopes: ["instagram_business_basic"] }));
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.destinations[0]!.status).toBe("needs-reconnect");
    expect(stage.graph.calls).toHaveLength(0);
  });

  test("a rate limit stops that destination instead of burning the whole set against it", async () => {
    stage.graph.on("POST", /\d+\/media$/, () => graphError(429, 4));
    const { data } = await ready(stage, 3, ["instagram-story"]);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    // One attempt, not three.
    expect(stage.graph.count("POST", /^\d+\/media$/)).toBe(1);

    // The set settles rather than leaving the page polling a rate limit forever,
    // and every photo carries the reason it did not go.
    const state = stage.record(data.id)!.destinations["instagram-story"]!;
    expect(state.units.map((unit) => unit.status)).toEqual(["failed", "failed", "failed"]);
    expect(state.status).toBe("failed");
    expect(view.status).toBe("done");
    expect(state.note).toMatch(/busy/i);

    // Failed is still sendable: once the limit clears, a retry sends all three.
    expect(state.units.every(unitSendable)).toBe(true);
    stage.graph.on("POST", /\d+\/media$/, () => ({ id: String(stage.graph.next++) }));
    const retried = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(retried.destinations[0]!.status).toBe("posted");
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(3);
  });
});

describe("When a publish answer is lost", () => {
  let stage: ReturnType<typeof world>;
  beforeEach(() => {
    stage = world();
  });

  test("Instagram's lost confirmation is settled by reading the container, not by re-sending", async () => {
    stage.graph.on("POST", /\d+\/media_publish$/, () => new Error("connection reset"));
    const { data } = await ready(stage, 1, ["instagram-story"]);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.destinations[0]!.status).toBe("uncertain");

    const containerId = stage.record(data.id)!.destinations["instagram-story"]!.units[0]!
      .containerId!;
    stage.graph.status(containerId, "PUBLISHED");
    const settled = await reconcileStoryBroadcast(OWNER, data.id, stage.deps);
    expect(settled.destinations[0]!.status).toBe("posted");
    // It was settled by reading, never by publishing again.
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(1);
  });

  test("a container that errored was never published, so the photo can go again", async () => {
    stage.graph.on("POST", /\d+\/media_publish$/, () => new Error("connection reset"));
    const { data } = await ready(stage, 1, ["instagram-story"]);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    const containerId = stage.record(data.id)!.destinations["instagram-story"]!.units[0]!
      .containerId!;

    stage.graph.status(containerId, "ERROR");
    const settled = await reconcileStoryBroadcast(OWNER, data.id, stage.deps);
    expect(settled.destinations[0]!.status).toBe("failed");
    expect(
      stage.record(data.id)!.destinations["instagram-story"]!.units[0]!.containerId,
    ).toBeUndefined();
  });

  test("a container that says nothing leaves the photo uncertain rather than posting it again", async () => {
    stage.graph.on("POST", /\d+\/media_publish$/, () => new Error("connection reset"));
    const { data } = await ready(stage, 1, ["instagram-story"]);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    const containerId = stage.record(data.id)!.destinations["instagram-story"]!.units[0]!
      .containerId!;
    stage.graph.status(containerId, "IN_PROGRESS");

    const settled = await reconcileStoryBroadcast(OWNER, data.id, stage.deps);
    expect(settled.destinations[0]!.status).toBe("uncertain");
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(1);
  });

  test("Facebook's lost confirmation is settled from the Page's own stories", async () => {
    stage.graph.on("POST", /fb:\d+\/photo_stories$/, (call) => {
      // The story is made; the answer never arrives.
      stage.graph.pageStories.push({
        post_id: `${PAGE}_777`,
        media_id: call.body["photo_id"] ?? "",
        status: "PUBLISHED",
      });
      return new Error("connection reset");
    });
    const { data } = await ready(stage, 1, ["facebook-story"]);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.destinations[0]!.status).toBe("uncertain");

    const settled = await reconcileStoryBroadcast(OWNER, data.id, stage.deps);
    expect(settled.destinations[0]!.status).toBe("posted");
    expect(stage.record(data.id)!.destinations["facebook-story"]!.units[0]!.storyId).toBe(
      `${PAGE}_777`,
    );
    expect(stage.graph.count("POST", /^fb:\d+\/photo_stories$/)).toBe(1);
  });

  test("a story Facebook does not list stays uncertain: absence is not proof", async () => {
    stage.graph.on("POST", /fb:\d+\/photo_stories$/, () => new Error("connection reset"));
    const { data } = await ready(stage, 1, ["facebook-story"]);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    const settled = await reconcileStoryBroadcast(OWNER, data.id, stage.deps);
    expect(settled.destinations[0]!.status).toBe("uncertain");
    // And it is still never sent again.
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(stage.graph.count("POST", /^fb:\d+\/photo_stories$/)).toBe(1);
  });

  test("reconciling cannot turn a posted photo back into one that would be sent again", async () => {
    const { data } = await ready(stage, 1, ["instagram-story", "facebook-story"]);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    stage.graph.pageStories = [];
    await reconcileStoryBroadcast(OWNER, data.id, stage.deps);
    const record = stage.record(data.id)!;
    for (const state of Object.values(record.destinations))
      expect(state!.units.every((unit) => unit.status === "posted")).toBe(true);
  });
});

describe("Slow platforms and expiry", () => {
  let stage: ReturnType<typeof world>;
  beforeEach(() => {
    stage = world();
  });

  test("a photo Instagram is still reading is handed back to the page, not abandoned", async () => {
    const { data } = await ready(stage, 1, ["instagram-story"]);
    stage.graph.on("GET", /\d+\?fields=status_code$/, () => ({ status_code: "IN_PROGRESS" }));
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    expect(view.status).toBe("broadcasting");
    expect(view.destinations[0]!.status).toBe("working");
    expect(stage.graph.count("POST", /^\d+\/media_publish$/)).toBe(0);

    // When it finishes, the next step publishes it, reusing the same container.
    const containerId = stage.record(data.id)!.destinations["instagram-story"]!.units[0]!
      .containerId!;
    stage.graph.on("GET", /\d+\?fields=status_code$/, () => ({ status_code: "FINISHED" }));
    const done = await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    expect(done.destinations[0]!.status).toBe("posted");
    expect(stage.graph.count("POST", /^\d+\/media$/)).toBe(1);
    expect(
      stage.graph.calls.filter(
        (call) =>
          call.path === `${ACCOUNT}/media_publish` && call.body["creation_id"] === containerId,
      ),
    ).toHaveLength(1);
  });

  test("a container Instagram never finishes is given up on, and can be posted again", async () => {
    const { data } = await ready(stage, 1, ["instagram-story"]);
    stage.graph.on("GET", /\d+\?fields=status_code$/, () => ({ status_code: "IN_PROGRESS" }));
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    stage.tick(6 * 60_000);
    const view = await advanceStoryBroadcast(OWNER, data.id, stage.deps);

    expect(view.destinations[0]!.status).toBe("failed");
    expect(view.destinations[0]!.note).toMatch(/too long/i);
    const unit = stage.record(data.id)!.destinations["instagram-story"]!.units[0]!;
    expect(unit.containerId).toBeUndefined();
    expect(unitSendable(unit)).toBe(true);
  });

  test("a set older than a day loses its photos and stops pretending it can post", async () => {
    const { data } = await ready(stage, 2, ["instagram-story"]);
    stage.tick(25 * 60 * 60_000);
    expect(await sweepStoryMedia(OWNER, stage.deps)).toBe(1);

    const record = stage.record(data.id)!;
    expect(record.status).toBe("expired");
    expect(record.mediaRemovedAt).toBeTruthy();
    expect(stage.db.removed).toHaveLength(2);
    expect(record.destinations["instagram-story"]!.status).toBe("failed");
  });

  test("a set that is already posted keeps its result when it is swept", async () => {
    const { data } = await ready(stage, 1, ["instagram-story"]);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    stage.tick(25 * 60 * 60_000);
    await sweepStoryMedia(OWNER, stage.deps);
    const record = stage.record(data.id)!;
    expect(record.status).toBe("done");
    expect(record.destinations["instagram-story"]!.status).toBe("posted");
  });
});

describe("Discarding and listing", () => {
  let stage: ReturnType<typeof world>;
  beforeEach(() => {
    stage = world();
  });

  test("a set nobody can have seen is discarded with its photos", async () => {
    const { data } = await ready(stage, 2);
    const view = await discardStoryBroadcast(OWNER, data.id, stage.deps);
    expect(view.status).toBe("discarded");
    expect(stage.db.removed).toHaveLength(2);
    expect(await listStoryBroadcasts(OWNER, { db: stage.db as never })).toHaveLength(0);
  });

  test("a set that is already out cannot be discarded", async () => {
    const { data } = await ready(stage, 1);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    await expect(discardStoryBroadcast(OWNER, data.id, stage.deps)).rejects.toThrow(
      /may already be posted/i,
    );
  });

  test("the list shows what happened per destination", async () => {
    const { data } = await ready(stage, 2);
    await advanceStoryBroadcast(OWNER, data.id, stage.deps);
    const [listed] = await listStoryBroadcasts(OWNER, { db: stage.db as never });
    expect(listed!.photos).toBe(2);
    expect(listed!.destinations.map((line) => line.label)).toEqual(["Instagram", "Facebook"]);
    expect(listed!.destinations.every((line) => line.status === "posted")).toBe(true);
  });
});
