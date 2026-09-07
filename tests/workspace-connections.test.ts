import { describe, expect, test } from "bun:test";
import {
  GMAIL_READONLY,
  GmailSession,
  plainMail,
  type GmailStatus,
} from "../src/lib/connections/gmail";
import {
  normalizeWebResults,
  safeWebUrl,
  externalSearchHref,
} from "../src/lib/connections/research";
import { admittedWebSearch, performWebSearch } from "../src/lib/connections/research.server";
import {
  explicitWorkspaceBinding,
  resolveWorkspaceBinding,
  parseWorkspaceRequest,
  projectScope,
  scopeToolHref,
  tabProjectScope,
  workspaceToolHref,
  workspaceToolText,
} from "../src/lib/workbench-projects";
import { studioBindingKey, workbenchTab, type StudioWorkbenchBinding } from "../src/lib/workbench";

const accountA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  accountB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const grant = { access_token: "fixture-not-a-real-token", expires_in: 3600, scope: GMAIL_READONLY };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rawMail = (id = "fixture1") => ({
  id,
  threadId: id,
  snippet: "Client asks about the delivery.",
  payload: {
    headers: [
      { name: "Subject", value: "A shoot" },
      { name: "From", value: "Fixture <fixture@example.test>" },
    ],
    mimeType: "text/plain",
    body: { data: btoa("Please warm the images slightly.") },
  },
});

describe("Gmail interactive-session boundaries", () => {
  test("malformed OAuth callbacks and profiles fail closed instead of leaving a stuck connection", async () => {
    const session = new GmailSession(
      () => {},
      async () => json({ emailAddress: { invalid: true } }),
    );
    for (const response of [
      null,
      {},
      { ...grant, scope: {} },
      { ...grant, expires_in: {} },
      { ...grant, access_token: [] },
      grant,
    ]) {
      await session.authorize(response, session.begin());
      expect(session.status.state).toBe("disconnected");
      expect(session.status.email).toBeNull();
    }
  });
  test("requires readonly consent, valid lifetime, and current popup generation", async () => {
    let reads = 0;
    const session = new GmailSession(
      () => {},
      async () => {
        reads++;
        return json({ emailAddress: "fixture@example.test" });
      },
    );
    let generation = session.begin();
    session.clear();
    await session.authorize(grant, generation);
    expect(reads).toBe(0);
    for (const bad of [
      { ...grant, scope: "profile" },
      { ...grant, expires_in: 0 },
      { ...grant, expires_in: "invalid" },
      { ...grant, error: "access_denied" },
    ]) {
      generation = session.begin();
      await session.authorize(bad, generation);
      expect(session.status.state).toBe("disconnected");
    }
    expect(reads).toBe(0);
    await session.authorize(grant, session.begin());
    expect(session.status.email).toBe("fixture@example.test");
    expect(JSON.stringify(session.status)).not.toContain(grant.access_token);
    session.clear();
  });
  test("expiry after browser sleep fails before making another API call", async () => {
    let time = 0,
      reads = 0;
    const session = new GmailSession(
      () => {},
      async () => {
        reads++;
        return json({ emailAddress: "fixture@example.test" });
      },
      () => time,
    );
    await session.authorize(grant, session.begin());
    time = 3_600_001;
    await expect(session.search("client")).rejects.toThrow("Reconnect");
    expect(reads).toBe(1);
    expect(session.status.state).toBe("disconnected");
  });
  test("401 clears access rather than reopening Google or looping", async () => {
    const session = new GmailSession(
      () => {},
      async (input) =>
        String(input).includes("profile")
          ? json({ emailAddress: "fixture@example.test" })
          : json({}, 401),
    );
    await session.authorize(grant, session.begin());
    await expect(session.search("client")).rejects.toThrow("Reconnect");
    expect(session.status.state).toBe("disconnected");
  });
  test("late message and late profile responses cannot cross a disconnected account", async () => {
    let resolveRead!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveRead = resolve;
    });
    const states: GmailStatus[] = [];
    const session = new GmailSession(
      (status) => states.push(status),
      async (input) =>
        String(input).includes("profile")
          ? json({ emailAddress: "fixture@example.test" })
          : response,
    );
    await session.authorize(grant, session.begin());
    const read = session.read("fixture1");
    session.clear();
    resolveRead(json(rawMail()));
    await expect(read).rejects.toThrow("cancelled");
    expect(session.status.email).toBeNull();
    let resolveProfile!: (response: Response) => void;
    const slow = new GmailSession(
      () => {},
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }),
    );
    const authorization = slow.authorize(grant, slow.begin());
    slow.clear();
    resolveProfile(json({ emailAddress: "old@example.test" }));
    await authorization;
    expect(slow.status.email).toBeNull();
    expect(slow.status.state).toBe("disconnected");
  });
  test("read operations use only fixed Google URLs and GET, with no mailbox writes", async () => {
    const calls: { url: string; method: string }[] = [];
    const session = new GmailSession(
      () => {},
      async (input, init) => {
        const url = new URL(String(input));
        calls.push({ url: url.href, method: init?.method ?? "" });
        expect(url.origin).toBe("https://gmail.googleapis.com");
        expect(url.href).not.toContain(grant.access_token);
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          `Bearer ${grant.access_token}`,
        );
        if (url.pathname.endsWith("profile")) return json({ emailAddress: "fixture@example.test" });
        if (url.pathname.endsWith("messages")) return json({ messages: [{ id: "fixture1" }] });
        return json(rawMail());
      },
    );
    await session.authorize(grant, session.begin());
    expect((await session.search("from:client@example.test")).messages).toHaveLength(1);
    expect((await session.read("fixture1")).text).toContain("Please warm");
    await expect(session.read("../../send")).rejects.toThrow("Invalid");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    session.clear();
  });
  test("HTML, tracking images and attachment bodies are not rendered as message text", () => {
    const message = plainMail(
      {
        ...rawMail(),
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "text/html",
              body: { data: btoa('<img src="https://tracker.test/pixel">') },
            },
            {
              mimeType: "text/plain",
              filename: "private.txt",
              body: { data: btoa("Attachment secret") },
            },
            { mimeType: "text/plain", body: { data: btoa("Visible plain text") } },
          ],
        },
      },
      true,
    );
    expect(message.text).toBe("Visible plain text");
    expect(JSON.stringify(message)).not.toContain("tracker.test");
  });
  test("oversized Gmail replies are refused and revoked sessions remain disconnected", async () => {
    const session = new GmailSession(
      () => {},
      async (input) =>
        String(input).includes("profile")
          ? json({ emailAddress: "fixture@example.test" })
          : new Response(new Uint8Array(2_000_001)),
    );
    await session.authorize(grant, session.begin());
    await expect(session.read("fixture1")).rejects.toThrow("too large");
    expect(await session.revoke((_token, done) => done({ successful: true }))).toBe(true);
    expect(session.status.state).toBe("disconnected");
  });
});

describe("grounded web results", () => {
  test("denied or unavailable durable admission never calls the paid provider", async () => {
    let calls = 0;
    const provider: typeof fetch = async () => {
      calls++;
      return json({});
    };
    await expect(
      admittedWebSearch(
        accountA,
        "lighting",
        "fixture-key",
        { take: async () => false, release: async () => {} },
        provider,
      ),
    ).rejects.toThrow("usage limit");
    await expect(
      admittedWebSearch(
        accountA,
        "lighting",
        "fixture-key",
        {
          take: async () => {
            throw new Error("protection offline");
          },
          release: async () => {},
        },
        provider,
      ),
    ).rejects.toThrow("protection offline");
    expect(calls).toBe(0);
  });
  test("successful and failed provider calls release their own durable lease", async () => {
    const leases: string[] = [],
      released: string[] = [];
    const admission = {
      take: async (owner: string, lease: string) => {
        expect(owner).toBe(accountA);
        leases.push(lease);
        return true;
      },
      release: async (lease: string) => {
        released.push(lease);
      },
    };
    await admittedWebSearch(accountA, "lighting", "fixture", admission, async () => json({}));
    await expect(
      admittedWebSearch(
        accountA,
        "lighting",
        "fixture",
        admission,
        async () => new Response("no", { status: 500 }),
      ),
    ).rejects.toThrow("could not complete");
    expect(released).toEqual(leases);
    expect(new Set(leases).size).toBe(2);
  });
  test("unsafe URLs and provider markup cannot become active app content", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "http://127.0.0.1/a",
      "http://10.0.0.1/a",
      "http://169.254.169.254/",
      "https://user:pass@example.test",
      "http://printer.local",
      "http://172.20.0.1",
    ])
      expect(safeWebUrl(url)).toBeNull();
    const results = normalizeWebResults({
      web: {
        results: [
          {
            title: "<b>Lighting</b>",
            url: "https://example.test/guide",
            description: "<b>Source</b> summary",
          },
          { title: "Duplicate", url: "https://example.test/guide" },
          { title: "Bad", url: "javascript:alert(1)" },
        ],
      },
    });
    expect(results).toEqual([
      {
        title: "Lighting",
        url: "https://example.test/guide",
        description: "Source summary",
        domain: "example.test",
      },
    ]);
    expect(externalSearchHref("light & shade")).toBe(
      "https://www.google.com/search?q=light%20%26%20shade",
    );
  });
  test("search adapter sends only the explicit query with server-side credential", async () => {
    const result = await performWebSearch("sports lighting", "fixture-key", async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.search.brave.com");
      expect(url.searchParams.get("q")).toBe("sports lighting");
      expect(url.href).not.toContain("fixture-key");
      expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe("fixture-key");
      return json({
        web: {
          results: [
            { title: "Source", url: "https://example.test", description: "Verified fixture" },
          ],
        },
      });
    });
    expect(result.results).toHaveLength(1);
    expect(result.query).toBe("sports lighting");
  });
  test("upstream failures are sanitized and response bodies are bounded", async () => {
    await expect(
      performWebSearch(
        "query",
        "secret",
        async () => new Response("secret upstream details", { status: 500 }),
      ),
    ).rejects.toThrow("could not complete");
    await expect(
      performWebSearch("query", "secret", async () => new Response(new Uint8Array(1_000_001))),
    ).rejects.toThrow("too much data");
  });
});

describe("multiple tabs inside one shoot", () => {
  test("numeric and JSON-looking research queries and message IDs round-trip without extra quotes", () => {
    for (const query of ["2026", "true", "null", '"wedding"', "client@example.test"]) {
      const href = workspaceToolHref("/research", query, { tab: "fixture" });
      expect(workspaceToolText(href, "q")).toBe(query);
      expect(workbenchTab(href)?.label).toBe(`Web research · ${query}`);
    }
    for (const id of ["12345678901234567890", "deadbeef12345678"]) {
      expect(workspaceToolText(workspaceToolHref("/mail", "", { message: id }), "message")).toBe(
        id,
      );
    }
    expect(workspaceToolText("/mail?message=12345678901234567890", "message")).toBe(
      "12345678901234567890",
    );
    expect(workspaceToolText("/research?q=a&q=b", "q")).toBeNull();
    expect(workspaceToolHref("/mail", "private client subject", { tab: "fixture" })).not.toContain(
      "private",
    );
    expect(
      new URL(
        workspaceToolHref("/mail", "private client subject"),
        "https://workspace.invalid",
      ).searchParams.has("q"),
    ).toBe(false);
  });
  const binding: StudioWorkbenchBinding = {
    kind: "ready",
    projectId: accountA,
    deliveryFocus: { frameId: "frame-1", versionId: "version-2" },
  };
  test("research, mail, delivery and chat preserve exact source identity", () => {
    for (const href of [
      "/research?q=lighting&tab=first",
      "/mail?tab=second",
      "/deliver?workflow=1",
      "/workspace",
    ]) {
      const scoped = scopeToolHref(href, binding);
      expect(studioBindingKey(explicitWorkspaceBinding(scoped, true)!)).toBe(
        studioBindingKey(binding),
      );
      expect(tabProjectScope(scoped)).toBe(accountA);
    }
  });
  test("same tool tabs have distinct URLs and independent stable identities", () => {
    const first = scopeToolHref(
      workspaceToolHref("/research", "lighting", { tab: "one" }),
      binding,
    );
    const second = scopeToolHref(
      workspaceToolHref("/research", "lighting", { tab: "two" }),
      binding,
    );
    expect(workbenchTab(first)?.href).not.toBe(workbenchTab(second)?.href);
    expect(tabProjectScope(first)).toBe(tabProjectScope(second));
    expect(projectScope(binding)).toBe(accountA);
  });
  test("an older research tab never rewinds the active delivery version", () => {
    const older = scopeToolHref("/research?tab=old", binding);
    const newer: StudioWorkbenchBinding = {
      ...binding,
      deliveryFocus: { frameId: "frame-1", versionId: "version-3" },
    };
    expect(resolveWorkspaceBinding(older, newer, true)).toBe(newer);
    expect(explicitWorkspaceBinding(older, true)).toEqual(binding);
    expect(
      resolveWorkspaceBinding(
        `/studio?project=${accountA}&deliveryFrame=frame-1&deliveryVersion=version-2`,
        newer,
        true,
      ),
    ).toEqual(binding);
    expect(resolveWorkspaceBinding(older, { kind: "ready", projectId: accountB }, true)).toEqual(
      binding,
    );
    expect(
      resolveWorkspaceBinding(
        `/research?workspaceProject=${accountA}&workspaceFrame=bad`,
        newer,
        true,
      ).kind,
    ).toBe("blocked");
  });
  test("case and trailing slash Studio links retain exact project scope", () => {
    for (const href of [`/studio/?project=${accountA}`, `/Studio?project=${accountA}`]) {
      expect(explicitWorkspaceBinding(href, true)).toEqual({ kind: "ready", projectId: accountA });
      expect(tabProjectScope(href)).toBe(accountA);
      expect(scopeToolHref(href, { kind: "ready", projectId: accountB })).toBe(href);
    }
  });
  test("explicit Studio and other-project targets are not rewritten", () => {
    expect(scopeToolHref("/studio", binding)).toBe("/studio");
    expect(scopeToolHref(`/studio?project=${accountB}`, binding)).toBe(
      `/studio?project=${accountB}`,
    );
    expect(scopeToolHref(`/mail?workspaceProject=${accountB}`, binding)).toBe(
      `/mail?workspaceProject=${accountB}`,
    );
  });
  test("unsupported, conflicting and incomplete project links block loading", () => {
    for (const href of [
      "/mail?workspaceProject=bad",
      `/research?workspaceProject=${accountA}&workspaceProject=${accountB}`,
      `/mail?workspaceProject=${accountA}&workspaceFrame=f`,
      "/research?workspaceFrame=f&workspaceVersion=v",
    ])
      expect(explicitWorkspaceBinding(href, true)?.kind).toBe("blocked");
    expect(explicitWorkspaceBinding(`/mail?workspaceProject=${accountA}`, false)?.kind).toBe(
      "blocked",
    );
  });
  test("chat research and mail commands are explicit, separate from photo actions", () => {
    expect(parseWorkspaceRequest("search the web for sports lighting")).toEqual({
      path: "/research",
      query: "sports lighting",
    });
    expect(parseWorkspaceRequest("search my gmail for Halden")).toEqual({
      path: "/mail",
      query: "Halden",
    });
    for (const command of [
      "search photos from today",
      "find the keepers",
      "send this email",
      "delete mail",
      "approve all edits",
    ])
      expect(parseWorkspaceRequest(command)).toBeNull();
  });
});
