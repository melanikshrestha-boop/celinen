import { expect, test } from "bun:test";
import {
  canScheduleNetwork,
  isLivePostNetwork,
  parseScheduleInput,
  secretsForNetworks,
} from "../src/lib/social/schedule";
import { parseAccessToken, parsePasteSecret } from "../src/lib/social-paste";
import { postPasteNetwork } from "../src/lib/social-paste-post";

test("only live networks can be scheduled", () => {
  expect(canScheduleNetwork("instagram")).toBe(true);
  expect(canScheduleNetwork("facebook")).toBe(true);
  expect(canScheduleNetwork("bluesky")).toBe(true);
  expect(canScheduleNetwork("x")).toBe(true);
  expect(canScheduleNetwork("linkedin")).toBe(true);
  expect(canScheduleNetwork("tiktok")).toBe(false);
  expect(canScheduleNetwork("youtube-shorts")).toBe(false);
  expect(isLivePostNetwork("pinterest")).toBe(false);
});

test("schedule input keeps UTC time and refuses empty captions", () => {
  const runAt = "2026-09-18T18:30:00.000Z";
  const parsed = parseScheduleInput({
    caption: "Gallery tonight.",
    networks: ["bluesky", "tiktok", "bluesky"],
    runAt,
  });
  expect(parsed.caption).toBe("Gallery tonight.");
  expect(parsed.networks).toEqual(["bluesky"]);
  expect(parsed.runAt).toBe(runAt);
  expect(() => parseScheduleInput({ caption: "  ", networks: ["x"], runAt })).toThrow();
  expect(() =>
    parseScheduleInput({ caption: "Hi", networks: ["tiktok"], runAt }),
  ).toThrow();
});

test("paste secrets are required for scheduled Bluesky", () => {
  const secret = parsePasteSecret("bluesky", {
    handle: "melani.bsky.social",
    appPassword: "abcd-efgh-ijkl-mnop",
  });
  expect(secretsForNetworks(["bluesky"], { bluesky: secret })).toEqual([secret]);
  expect(() => secretsForNetworks(["bluesky"], {})).toThrow("Connect Bluesky first.");
});

test("X access tokens reject junk", () => {
  expect(parseAccessToken("AAAAAAAAAAAAAAAAAAAAAxx", "X").length).toBeGreaterThan(19);
  expect(() => parseAccessToken("short", "X")).toThrow();
});

test("X posts to the tweets API once", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify({ data: { id: "1" } }), { status: 201 });
  }) as typeof fetch;
  try {
    const result = await postPasteNetwork({
      secret: parsePasteSecret("x", { token: "AAAAAAAAAAAAAAAAAAAAAxx" }),
      caption: "Gallery tonight.",
    });
    expect(result).toEqual({ ok: true, network: "x" });
    expect(calls).toEqual(["POST https://api.x.com/2/tweets"]);
  } finally {
    globalThis.fetch = original;
  }
});
