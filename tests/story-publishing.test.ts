import { describe, expect, test } from "bun:test";
import { newPublication, publicationInput } from "../src/lib/business/publishing";
import { publishStories } from "../src/lib/business/story-publishing.server";
import { facebookRequest } from "../src/lib/business/facebook.server";

function harness() {
  const post = newPublication(
    {
      id: crypto.randomUUID(),
      roomId: crypto.randomUUID(),
      title: "Public",
      caption: "Approved caption",
      versionIds: [crypto.randomUUID()],
      permission: true,
      instagram: false,
      portfolio: false,
      instagramStory: true,
      facebookStory: true,
    },
    "111",
  );
  post.facebookPageId = "222";
  const writes: string[] = [],
    saved: (typeof post)[] = [];
  let lost = false,
    processing = "FINISHED",
    type = "BUSINESS",
    saveFails = false;
  const dependencies = {
    instagramCredential: async () => "secret-instagram",
    facebookCredential: async () => "secret-facebook",
    instagramRequest: async (path: string, _token: string, body?: URLSearchParams) => {
      if (path.includes("account_type")) return { account_type: type };
      if (path.endsWith("/media_publish")) {
        expect(saved.at(-1)?.destinations.instagramStory?.status).toBe("publishing");
        writes.push("instagram");
        if (lost) throw new Error("network interrupted");
        return { id: "555" };
      }
      if (path.endsWith("/media")) {
        expect(body?.get("media_type")).toBe("STORIES");
        expect(body?.has("caption")).toBe(false);
        return { id: "444" };
      }
      return { status_code: processing };
    },
    facebookRequest: async (path: string, _token: string, body?: URLSearchParams) => {
      if (path.endsWith("/photos")) {
        expect(body?.get("published")).toBe("false");
        return { id: "777" };
      }
      expect(saved.at(-1)?.destinations.facebookStory?.status).toBe("publishing");
      expect(body?.get("photo_id")).toBe("777");
      writes.push("facebook");
      if (lost) throw new Error("network interrupted");
      return { success: true, post_id: "222_888" };
    },
  };
  const run = () =>
    publishStories(
      "owner",
      post,
      async () => "https://example.test/prepared.jpg",
      async () => {
        if (saveFails) throw new Error("storage offline");
        saved.push(structuredClone(post));
      },
      dependencies,
    );
  return {
    post,
    writes,
    run,
    lost: () => {
      lost = true;
    },
    processing: (value: string) => {
      processing = value;
    },
    creator: () => {
      type = "MEDIA_CREATOR";
    },
    failSave: () => {
      saveFails = true;
    },
  };
}
describe("Stories publishing", () => {
  test("Stories require one image and consent; old publications remain valid", () => {
    const h = harness();
    const {
      createdAt,
      permissionAt,
      paths,
      destinations,
      instagramAccountId,
      facebookPageId,
      ...input
    } = h.post;
    expect(publicationInput.safeParse(input).success).toBe(true);
    expect(
      publicationInput.safeParse({
        ...input,
        versionIds: [crypto.randomUUID(), crypto.randomUUID()],
      }).success,
    ).toBe(false);
    expect(publicationInput.safeParse({ ...input, permission: false }).success).toBe(false);
  });
  test("each destination publishes once, only after durable intent; retry is a no-op", async () => {
    const h = harness();
    await h.run();
    await h.run();
    expect(h.writes).toEqual(["instagram", "facebook"]);
    expect(h.post.destinations.instagramStory?.status).toBe("published");
    expect(h.post.destinations.facebookStory?.status).toBe("published");
  });
  test("lost confirmations never repost, even across repeated attempts", async () => {
    const h = harness();
    h.lost();
    await h.run();
    for (let i = 0; i < 30; i++) await h.run();
    expect(h.writes).toEqual(["instagram", "facebook"]);
    expect(h.post.destinations.instagramStory?.status).toBe("uncertain");
    expect(h.post.destinations.facebookStory?.status).toBe("uncertain");
    h.processing("PUBLISHED");
    await h.run();
    expect(h.post.destinations.instagramStory?.status).toBe("published");
    expect(h.writes).toHaveLength(2);
  });
  test("one provider preparing does not block the other; later retry only publishes unfinished work", async () => {
    const h = harness();
    h.processing("IN_PROGRESS");
    await h.run();
    expect(h.writes).toEqual(["facebook"]);
    h.processing("FINISHED");
    await h.run();
    expect(h.writes).toEqual(["facebook", "instagram"]);
  });
  test("creator account is rejected for IG Stories without blocking Facebook", async () => {
    const h = harness();
    h.creator();
    await h.run();
    expect(h.post.destinations.instagramStory?.note).toContain("Business account");
    expect(h.writes).toEqual(["facebook"]);
  });
  test("failed durable storage prevents provider writes", async () => {
    const h = harness();
    h.failSave();
    await expect(h.run()).rejects.toThrow("storage offline");
    expect(h.writes).toHaveLength(0);
  });
  for (const destination of ["instagramStory", "facebookStory"] as const)
    test(`${destination}: a lost durable success receipt survives restart without reposting`, async () => {
      let post = structuredClone(harness().post);
      post.instagramStory = destination === "instagramStory";
      post.facebookStory = destination === "facebookStory";
      let durable = structuredClone(post);
      let providerWrites = 0;
      let failReceipt = true;
      let reconciled = false;
      const dependencies = {
        instagramCredential: async () => "synthetic-instagram",
        facebookCredential: async () => "synthetic-facebook",
        instagramRequest: async (path: string) => {
          if (path.includes("account_type")) return { account_type: "BUSINESS" };
          if (path.endsWith("/media_publish")) {
            expect(durable.destinations[destination]?.status).toBe("publishing");
            providerWrites++;
            return { id: "555" };
          }
          if (path.endsWith("/media")) return { id: "444" };
          return { status_code: reconciled ? "PUBLISHED" : "FINISHED" };
        },
        facebookRequest: async (path: string) => {
          if (path.endsWith("/photos")) return { id: "777" };
          expect(durable.destinations[destination]?.status).toBe("publishing");
          providerWrites++;
          return { success: true, post_id: "222_888" };
        },
      };
      const run = () =>
        publishStories(
          "owner",
          post,
          async () => "https://example.test/fixture.jpg",
          async () => {
            if (failReceipt && post.destinations[destination]?.status === "published")
              throw new Error("final receipt storage failed");
            durable = structuredClone(post);
          },
          dependencies,
        );
      await expect(run()).rejects.toThrow("final receipt storage failed");
      expect(providerWrites).toBe(1);
      expect(durable.destinations[destination]?.status).toBe("publishing");
      // Throw away the successful in-memory object, as an actual process restart would.
      post = structuredClone(durable);
      failReceipt = false;
      for (let retry = 0; retry < 3; retry++) {
        await run();
        post = structuredClone(durable);
      }
      expect(providerWrites).toBe(1);
      expect(durable.destinations[destination]?.status).toBe("uncertain");
      if (destination === "instagramStory") {
        reconciled = true;
        await run();
        expect(durable.destinations[destination]?.status).toBe("published");
      }
      expect(providerWrites).toBe(1);
    });
  test("Facebook errors cannot echo provider tokens", async () => {
    await expect(
      facebookRequest(
        "222/photo_stories",
        "private-token",
        new URLSearchParams({ photo_id: "1" }),
        async () => new Response("private-token", { status: 403 }),
      ),
    ).rejects.toThrow("publishing permissions");
    await expect(facebookRequest("../../foreign", "token")).rejects.toThrow(
      "Invalid Facebook request",
    );
  });
});
