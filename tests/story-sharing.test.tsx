import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  publicStoryHead,
  publicStoryInvitation,
  creatorInquiryPath,
} from "../src/lib/business/story-sharing";
import { storyCoverResponse } from "../src/lib/business/story-cover.server";
import { publicPhotographer } from "../src/lib/commerce/service.server";
import { publicPortfolio } from "../src/lib/business/publishing.server";
import { parseAuthSearch } from "../src/lib/auth-flow";
import { PublicStory } from "../src/components/business/PublicStory";
import { emptyPhotographer } from "../src/lib/commerce/model";

const id = "73713bbc-125a-44d8-ae7d-195345ee0987";
const owner = "174b50d4-6b85-42be-9d91-5cf129f10be2";
const version = "cccb5d6a-d2a0-4fe8-92e3-b4985d6e8801";
const story = {
  title: "A night in Kathmandu",
  caption: "The city after sunset.",
  images: ["https://example.test/photo.jpg"],
  portfolioUrl: `/photographer/${owner}`,
  creator: { owner, displayName: "Céline & Co", available: true },
};
function database() {
  type TestQuery = {
    select: () => TestQuery;
    eq: (key: string, value: unknown) => TestQuery;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
  const record = {
    id,
    roomId: crypto.randomUUID(),
    title: story.title,
    caption: story.caption,
    versionIds: [version],
    instagram: false,
    portfolio: true,
    permission: true,
    paths: [`${owner}/${id}/${version}.jpg`],
    destinations: { portfolio: { status: "published" } },
  };
  const row = { record, owner_id: owner };
  const publicRow = {
    owner_id: owner,
    visible: true,
    profile: {
      ...emptyPhotographer(),
      displayName: "Céline & Co",
      specialties: ["Portrait"],
      visible: true,
    },
  };
  const calls: unknown[] = [];
  const state = {
    row,
    publicRow,
    error: null as unknown,
    storageError: null as unknown,
    bytes: new Uint8Array([255, 216, 255, 1, 2]),
    size: 5,
    contentType: "image/jpeg",
  };
  const db = {
    from: (table: string) => {
      calls.push(table);
      const q: TestQuery = {
        select: () => q,
        eq: (key: string, val: unknown) => {
          calls.push([key, val]);
          return q;
        },
        maybeSingle: async () => ({
          data: table === "photographer_directory" ? state.publicRow : state.row,
          error: state.error,
        }),
      };
      return q;
    },
    storage: {
      from: (bucket: string) => ({
        info: async (path: string) => {
          calls.push([bucket, "info", path]);
          return {
            data: { size: state.size, contentType: state.contentType },
            error: state.storageError,
          };
        },
        download: async (path: string) => {
          calls.push([bucket, "download", path]);
          return { data: new Blob([state.bytes]), error: state.storageError };
        },
        createSignedUrls: async () => ({
          data: [{ signedUrl: "https://example.test/public.jpg" }],
          error: null,
        }),
      }),
    },
  } as unknown as NonNullable<Parameters<typeof publicPhotographer>[1]>;
  return { db, state, calls };
}

describe("creator-first public sharing", () => {
  test("forwarded payload contains only the canonical public story", () => {
    const invite = publicStoryInvitation(id, story.title, story.creator.displayName);
    expect(invite.url).toBe(`https://lenslab.dev/p/${id}`);
    expect(invite.text).toContain("Céline & Co");
    const mail = new URL(invite.emailHref);
    expect(mail.pathname).toBe("");
    expect(mail.searchParams.get("body")).toContain(invite.url);
    expect(invite.url).not.toContain("#");
    expect(invite.url).not.toContain("shoot");
  });
  test.each(["", "../review/token", `${id}#secret`, `${id}?token=secret`, "javascript:alert(1)"])(
    "rejects non-public story identifiers %s",
    (bad) => {
      expect(() => publicStoryInvitation(bad, "Title")).toThrow();
      expect(() => creatorInquiryPath(bad)).toThrow();
    },
  );
  test("record-specific preview uses stable cover endpoint, not expiring media tokens", () => {
    const head = publicStoryHead(id, story);
    expect(head.meta).toContainEqual({
      property: "og:title",
      content: `${story.title} — Céline & Co`,
    });
    expect(head.meta).toContainEqual({
      property: "og:image",
      content: `https://lenslab.dev/api/public/stories/${id}/cover`,
    });
    expect(head.meta).toContainEqual({ name: "twitter:description", content: story.caption });
    expect(JSON.stringify(head)).not.toContain("example.test");
    expect(publicStoryHead(id, { ...story, title: "Another story" })).not.toEqual(head);
  });
  test("unavailable story metadata has no photo or canonical image", () => {
    const head = publicStoryHead("invalid");
    expect(JSON.stringify(head)).not.toContain("og:image");
    expect(JSON.stringify(head)).not.toContain("twitter:image");
  });
  test("rendered page is public, escaped, creator-first, without invented popularity", () => {
    const html = renderToStaticMarkup(
      <PublicStory postId={id} story={{ ...story, title: "<script>test</script>" }} />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Share story");
    expect(html).toContain(creatorInquiryPath(owner));
    expect(html.indexOf("Work with this creator")).toBeLessThan(
      html.indexOf("Create your own photo story"),
    );
    expect(html).not.toContain("likes");
    expect(html).not.toContain("Sign in to view");
  });
  test("unavailable and private identities do not offer bookings or made-up credits", () => {
    const unavailable = renderToStaticMarkup(
      <PublicStory
        postId={id}
        story={{ ...story, creator: { ...story.creator, available: false } }}
      />,
    );
    expect(unavailable).not.toContain("Work with this creator");
    const privateProfile = renderToStaticMarkup(
      <PublicStory postId={id} story={{ ...story, creator: null }} />,
    );
    expect(privateProfile).not.toContain("Céline");
    expect(privateProfile).not.toContain("story-inquiry");
  });
  test("sign-in return preserves the exact intended creator", () => {
    const next = creatorInquiryPath(owner);
    expect(parseAuthSearch({ next }).next).toBe(next);
    expect(new URL(`https://lenslab.dev${next}`).searchParams.get("creator")).toBe(owner);
  });
  test("public-profile lookup is exact and requires both visibility flags", async () => {
    const h = database();
    expect(await publicPhotographer(owner, h.db)).toEqual({ ...h.state.publicRow.profile, owner });
    expect(h.calls).toContainEqual(["owner_id", owner]);
    expect(h.calls).toContainEqual(["visible", true]);
    h.state.publicRow.visible = false;
    expect(await publicPhotographer(owner, h.db)).toBeNull();
    h.state.publicRow.visible = true;
    h.state.publicRow.profile.visible = false;
    expect(await publicPhotographer(owner, h.db)).toBeNull();
  });
  test("public story DTO excludes private publishing context and private profile", async () => {
    const h = database();
    h.state.publicRow.visible = false;
    const result = await publicPortfolio(id, h.db);
    expect(result.creator).toBeNull();
    for (const field of ["roomId", "permissionAt", "paths", "owner_id", "token"])
      expect(JSON.stringify(result)).not.toContain(field);
  });
});

describe("public preview media boundary", () => {
  test("published permissioned cover returns bounded JPEG without signed URL redirect", async () => {
    const h = database();
    const response = await storyCoverResponse(id, h.db);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(h.state.bytes);
    expect(h.calls).toContainEqual([
      "publishing-media-v1",
      "download",
      h.state.row.record.paths[0],
    ]);
  });
  test.each(["off", "pending", "preparing", "failed", "uncertain"])(
    "%s cannot be unfurled",
    async (status) => {
      const h = database();
      h.state.row.record.destinations.portfolio.status = status;
      expect((await storyCoverResponse(id, h.db)).status).toBe(404);
      expect(JSON.stringify(h.calls)).not.toContain("download");
    },
  );
  test("unpublish stops new preview requests", async () => {
    const h = database();
    expect((await storyCoverResponse(id, h.db)).status).toBe(200);
    h.state.row.record.portfolio = false;
    expect((await storyCoverResponse(id, h.db)).status).toBe(404);
  });
  test("permission is required even on a published record", async () => {
    const h = database();
    h.state.row.record.permission = false;
    expect((await storyCoverResponse(id, h.db)).status).toBe(404);
    expect(JSON.stringify(h.calls)).not.toContain("download");
  });
  test.each([
    "other-owner/public.jpg",
    "../delivery-private-v1/photo.jpg",
    "https://example.test/photo",
    "",
  ])("cannot substitute cover path %s", async (path) => {
    const h = database();
    h.state.row.record.paths = [path];
    expect((await storyCoverResponse(id, h.db)).status).toBe(404);
    expect(JSON.stringify(h.calls)).not.toContain("download");
  });
  test("invalid IDs never touch storage", async () => {
    const h = database();
    expect((await storyCoverResponse("bad", h.db)).status).toBe(404);
    expect(h.calls).toEqual([]);
  });
  test("oversize media is rejected before download", async () => {
    const h = database();
    h.state.size = 8 * 1024 * 1024 + 1;
    expect((await storyCoverResponse(id, h.db)).status).toBe(503);
    expect(JSON.stringify(h.calls)).not.toContain("download");
  });
  test("mismatched size and wrong magic are not served as images", async () => {
    const h = database();
    h.state.size = 10;
    expect((await storyCoverResponse(id, h.db)).status).toBe(503);
    h.state.size = 5;
    h.state.bytes = new Uint8Array([60, 115, 118, 103, 62]);
    expect((await storyCoverResponse(id, h.db)).status).toBe(503);
  });
  test("storage failures are retryable and do not leak upstream errors", async () => {
    const h = database();
    h.state.storageError = new Error("secret-service-key");
    const response = await storyCoverResponse(id, h.db);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
