import { describe, expect, test } from "bun:test";
import { buildWorkspaceClient, emptyClientInput } from "../src/lib/client-workspace";
import {
  clientCsv,
  dueClients,
  nextFollowUp,
  reminderCalendar,
} from "../src/lib/business/reminders";
import {
  canRetryInstagram,
  captionDraft,
  eligibleVersions,
  newPublication,
  publicationInput,
  validatePublicSelection,
} from "../src/lib/business/publishing";
import { openToken, sealToken, instagramRequest } from "../src/lib/business/instagram.server";
import { runPublication, publicPortfolio, publicPortfolioIndex } from "../src/lib/business/publishing.server";
import { newDelivery, type DeliveryVersion } from "../src/lib/delivery/workflow";

function client(name = "Test client", followUpOn = "2026-09-06") {
  const result = buildWorkspaceClient({ ...emptyClientInput(), name, followUpOn });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function fixture(count = 1) {
  const owner = crypto.randomUUID(),
    roomId = crypto.randomUUID();
  const state = newDelivery(
    {
      id: roomId,
      title: "Test shoot",
      clientName: "Private client",
      message: "Private note",
      selectionLimit: 10,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    new Date().toISOString(),
  );
  state.status = "live";
  const variants = {
    proof: { width: 1200, height: 800, sha256: "a".repeat(64), bytes: 500 },
    phone: { width: 1200, height: 800, sha256: "b".repeat(64), bytes: 500 },
    full: { width: 2400, height: 1600, sha256: "c".repeat(64), bytes: 2000 },
  };
  const versions: DeliveryVersion[] = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    photoId: crypto.randomUUID(),
    filename: "goal.jpg",
    source: null,
    variants: structuredClone(variants),
    ready: true,
    number: 1,
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  }));
  state.photos = versions.map((v) => ({
    id: v.photoId,
    current: v.id,
    published: v.id,
    versions: [v],
  }));
  state.released = versions.map((v) => v.id);
  state.approvals = versions.map((v) => ({
    versionId: v.id,
    at: new Date().toISOString(),
    revokedAt: null,
  }));
  const post = newPublication(
    {
      id: crypto.randomUUID(),
      roomId,
      title: "Public story",
      caption: "Public caption",
      versionIds: state.released,
      portfolio: true,
      instagram: true,
      permission: true,
    },
    "123",
  );
  return { owner, roomId, state, versions, post };
}

describe("client follow-ups", () => {
  test("due includes today, excludes archived, sorts overdue first, leaves records unchanged", () => {
    const records = [
      client("Today"),
      client("Late", "2026-09-01"),
      client("Tomorrow", "2026-09-07"),
      { ...client("Archived"), stage: "archived" as const },
    ];
    const before = structuredClone(records);
    expect(dueClients(records, "2026-09-06").map((c) => c.name)).toEqual(["Late", "Today"]);
    expect(records).toEqual(before);
  });
  test("calendar arithmetic handles leap years, DST and year boundaries without timezone drift", () => {
    expect(nextFollowUp("2028-02-28", 1)).toBe("2028-02-29");
    expect(nextFollowUp("2026-12-31", 1)).toBe("2027-01-01");
    expect(nextFollowUp("2026-03-08", 7)).toBe("2026-03-15");
    expect(() => nextFollowUp("2026-02-30")).toThrow();
  });
  test("calendar escapes injection and folds Unicode by bytes without exposing contact/brief", () => {
    const row = {
      ...client("Nova;\nBEGIN:VEVENT" + "✨".repeat(60)),
      email: "private@example.com",
      brief: "Private brief",
    };
    const ics = reminderCalendar([row]);
    expect(ics.split("\r\n").filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics).not.toContain(row.email);
    expect(ics).not.toContain(row.brief);
    for (const line of ics.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(74);
    expect(ics).toContain("BEGIN:VALARM");
  });
  test("CSV quotes delimiters and neutralizes spreadsheet formulas", () => {
    const csv = clientCsv([
      { ...client('=HYPERLINK("bad")'), org: "One, two", phone: "+15551234567" },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain('"One, two"');
    expect(csv).toContain(`"'+15551234567"`);
  });
});
describe("public marketing gates", () => {
  test("requires explicit permission, a destination, unique images and at most ten", () => {
    const { post } = fixture();
    const input = {
      id: post.id,
      roomId: post.roomId,
      title: post.title,
      caption: post.caption,
      versionIds: post.versionIds,
      instagram: true,
      portfolio: true,
      permission: true,
    };
    for (const patch of [
      { permission: false },
      { instagram: false, portfolio: false },
      { versionIds: [...post.versionIds, ...post.versionIds] },
      { versionIds: Array.from({ length: 11 }, () => crypto.randomUUID()) },
      { caption: "x".repeat(2201) },
    ])
      expect(publicationInput.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  test("rejects private, unreleased, revoked, expired and stale image versions", () => {
    const { state, versions } = fixture();
    expect(eligibleVersions(state)).toHaveLength(1);
    for (const mutate of [
      (s: typeof state) => {
        s.status = "draft";
      },
      (s: typeof state) => {
        s.released = [];
      },
      (s: typeof state) => {
        s.approvals[0]!.revokedAt = new Date().toISOString();
      },
      (s: typeof state) => {
        s.expiresAt = "2020-01-01T00:00:00Z";
      },
      (s: typeof state) => {
        s.photos[0]!.published = crypto.randomUUID();
      },
    ]) {
      const next = structuredClone(state);
      mutate(next);
      expect(() => validatePublicSelection(next, [versions[0]!.id], true)).toThrow();
    }
  });
  test("rejects inappropriate Instagram crops without blocking the same portfolio photo", () => {
    const { state, versions } = fixture();
    versions[0]!.variants.phone.width = 400;
    expect(() => validatePublicSelection(state, [versions[0]!.id], true)).toThrow("4:5");
    expect(validatePublicSelection(state, [versions[0]!.id], false)).toHaveLength(1);
  });
  test("caption draft is editable text from supplied facts, with a small relevant hashtag set", () => {
    const caption = captionDraft("Friday lights", "The home opener", "sports", "minimal");
    expect(caption).toContain("Friday lights");
    expect(caption).toContain("The home opener");
    expect(caption).toContain("#SportsPhotography");
    expect(caption).not.toContain("Private client");
    expect(caption.match(/#/g)).toHaveLength(3);
  });
  test("token encryption authenticates account ownership and tampering", () => {
    const key = Buffer.alloc(32, 7),
      cipher = sealToken("test-secret", "owner-a", key);
    expect(cipher).not.toContain("test-secret");
    expect(openToken(cipher, "owner-a", key)).toBe("test-secret");
    expect(() => openToken(cipher, "owner-b", key)).toThrow();
    expect(() => openToken(cipher.slice(0, 10) + "Z" + cipher.slice(11), "owner-a", key)).toThrow();
  });
  test("provider errors do not expose tokens or raw upstream response", async () => {
    const request = async (url: unknown, init?: RequestInit) => {
      expect(String(url)).not.toContain("secret");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return new Response("secret and diagnostic data", { status: 429 });
    };
    await expect(
      instagramRequest("123/media", "secret", new URLSearchParams(), request as typeof fetch),
    ).rejects.toThrow("busy");
  });
});

function harness(count = 1) {
  const f = fixture(count);
  let row = {
    id: f.post.id,
    owner_id: f.owner,
    record: structuredClone(f.post),
    revision: 0,
    lease: null as string | null,
  };
  let publishes = 0,
    copies = 0,
    lostConfirmation = false,
    preparationFails = false,
    providerStatus = "FINISHED";
  const db = {
    from: () => {
      let patch: Record<string, unknown> = {},
        checks: [string, unknown][] = [],
        claim = false;
      const builder: any = {
        update: (p: Record<string, unknown>) => {
          patch = structuredClone(p);
          return builder;
        },
        eq: (k: string, v: unknown) => {
          checks.push([k, v]);
          return builder;
        },
        or: () => {
          claim = true;
          return builder;
        },
        select: () => builder,
        maybeSingle: async () => {
          if (checks.some(([key, value]) => (row as any)[key] !== value) || (claim && row.lease))
            return { data: null, error: null };
          row = { ...row, ...patch } as typeof row;
          return { data: structuredClone(row), error: null };
        },
        then: (resolve: (result: unknown) => unknown) => builder.maybeSingle().then(resolve),
      };
      return builder;
    },
    storage: {
      getBucket: async () => ({
        data: { public: false, file_size_limit: 8388608, allowed_mime_types: ["image/jpeg"] },
      }),
      from: () => ({
        copy: async () => {
          copies++;
          return { error: null };
        },
        createSignedUrl: async () => ({
          data: { signedUrl: "https://example.com/test.jpg" },
          error: null,
        }),
      }),
    },
  };
  const deps = {
    db: db as any,
    owned: async (_id: string, owner: string) => {
      if (owner !== f.owner) throw new Error("foreign owner");
      return { state: f.state } as any;
    },
    instagramCredential: async () => "fixture-token",
    instagramRequest: async (path: string) => {
      if (path.endsWith("/media_publish")) {
        publishes++;
        if (lostConfirmation) throw new Error("Network interrupted");
        return { id: "999" };
      }
      if (path.endsWith("/media")) {
        if (preparationFails) throw new Error("Preparation failed");
        return { id: "1234" };
      }
      if (path.includes("permalink")) return { permalink: "https://www.instagram.com/p/test/" };
      return { status_code: providerStatus };
    },
  };
  return {
    ...f,
    deps,
    row: () => row,
    copies: () => copies,
    publishes: () => publishes,
    loseConfirmation: () => {
      lostConfirmation = true;
    },
    failPreparation: (on: boolean) => {
      preparationFails = on;
    },
    status: (value: string) => {
      providerStatus = value;
    },
  };
}
describe("durable publishing orchestration with isolated provider fixtures", () => {
  test("publishes to both destinations, preserves private data, repeat request is a no-op", async () => {
    const h = harness(2);
    const result = await runPublication(h.owner, h.post.id, h.deps);
    expect(result.destinations.portfolio.status).toBe("published");
    expect(result.destinations.instagram.status).toBe("published");
    await runPublication(h.owner, h.post.id, h.deps);
    expect(h.publishes()).toBe(1);
    expect(h.copies()).toBe(2);
    expect(h.state.message).toBe("Private note");
  });
  test("lost confirmation is not reposted, and later provider status reconciles", async () => {
    const h = harness();
    h.loseConfirmation();
    const post = await runPublication(h.owner, h.post.id, h.deps);
    expect(post.destinations.instagram.status).toBe("uncertain");
    expect(canRetryInstagram(post)).toBe(false);
    await runPublication(h.owner, h.post.id, h.deps);
    expect(h.publishes()).toBe(1);
    h.status("PUBLISHED");
    const reconciled = await runPublication(h.owner, h.post.id, h.deps);
    expect(reconciled.destinations.instagram.status).toBe("published");
    expect(h.publishes()).toBe(1);
  });
  test("Instagram preparation failure preserves successful portfolio and retries only unfinished work", async () => {
    const h = harness();
    h.failPreparation(true);
    const first = await runPublication(h.owner, h.post.id, h.deps);
    expect(first.destinations.portfolio.status).toBe("published");
    expect(first.destinations.instagram.status).toBe("failed");
    h.failPreparation(false);
    await runPublication(h.owner, h.post.id, h.deps);
    expect(h.copies()).toBe(1);
    expect(h.publishes()).toBe(1);
  });
  test("foreign owner cannot claim a post or reach the provider", async () => {
    const h = harness();
    await expect(runPublication(crypto.randomUUID(), h.post.id, h.deps)).rejects.toThrow(
      "unavailable",
    );
    expect(h.publishes()).toBe(0);
    expect(h.copies()).toBe(0);
  });
  test("concurrent attempts acquire at most one lease", async () => {
    const h = harness();
    const results = await Promise.allSettled([
      runPublication(h.owner, h.post.id, h.deps),
      runPublication(h.owner, h.post.id, h.deps),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(h.publishes()).toBe(1);
  });
  test("unpublished portfolio stories never issue a signed image URL", async () => {
    const f = fixture(); let signed = false;
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: {record:f.post,owner_id:f.owner}, error:null }) };
    const db: any = {from:()=>query,storage:{from:()=>({createSignedUrls:async()=>{signed=true;return {data:[],error:null};}})}};
    await expect(publicPortfolio(f.post.id,db)).rejects.toThrow("not available");
    expect(signed).toBe(false);
  });
  test("public portfolio projects only published story titles and copied cover images", async () => {
    const f = fixture(); const live = structuredClone(f.post);
    live.destinations.portfolio.status="published"; live.paths=["public-copy.jpg"];
    const checked: unknown[]=[];
    const query: any = {select:()=>query,eq:(key: string,value:unknown)=>{checked.push([key,value]);return query;},order:()=>query,limit:async()=>({data:[{id:live.id,record:live},{id:crypto.randomUUID(),record:f.post}],error:null})};
    const db: any = {from:()=>query,storage:{from:()=>({createSignedUrls:async(paths:string[])=>{expect(paths).toEqual(["public-copy.jpg"]);return {data:[{signedUrl:"https://example.com/cover.jpg"}],error:null};}})}};
    const result=await publicPortfolioIndex(f.owner,db);
    expect(result).toEqual([{id:live.id,title:live.title,image:"https://example.com/cover.jpg"}]);
    expect(checked).toContainEqual(["owner_id",f.owner]);
    expect(JSON.stringify(result)).not.toContain("Private client");
    expect(JSON.stringify(result)).not.toContain("roomId");
  });
});
