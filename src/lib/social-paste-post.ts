/** Server-side paste posts. Secrets are not stored here. One attempt; no retry. */
import {
  clipPasteCaption,
  parsePasteSecret,
  type PasteSecret,
  type PasteSocialId,
} from "./social-paste";

const TIMEOUT_MS = 8_000;

export type PastePostResult = { ok: true; network: PasteSocialId } | { ok: false; error: string };

function asSecret(value: unknown): PasteSecret {
  if (!value || typeof value !== "object") throw new Error("Connect this account first.");
  const row = value as PasteSecret;
  if (row.id === "bluesky")
    return parsePasteSecret("bluesky", { handle: row.handle, appPassword: row.appPassword });
  if (row.id === "mastodon")
    return parsePasteSecret("mastodon", { instance: row.instance, token: row.token });
  if (row.id === "discord") return parsePasteSecret("discord", { webhook: row.webhook });
  throw new Error("Connect this account first.");
}

async function readJson(response: Response) {
  const text = await response.text();
  if (text.length > 64_000) throw new Error("That network returned too much data.");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function postPasteNetwork(input: {
  secret: unknown;
  caption: string;
}): Promise<PastePostResult> {
  try {
    const secret = asSecret(input.secret);
    const caption = clipPasteCaption(String(input.caption ?? ""), secret.id);
    if (!caption) return { ok: false, error: "Write a caption first." };
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    if (secret.id === "bluesky") {
      const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: secret.handle, password: secret.appPassword }),
        signal,
        redirect: "error",
      });
      const session = await readJson(sessionRes);
      if (!sessionRes.ok || typeof session.accessJwt !== "string" || typeof session.did !== "string")
        return { ok: false, error: "Bluesky could not sign in with that app password." };
      const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: caption,
            createdAt: new Date().toISOString(),
          },
        }),
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "Bluesky rejected this post." };
      return { ok: true, network: "bluesky" };
    }
    if (secret.id === "mastodon") {
      const postRes = await fetch(`${secret.instance}/api/v1/statuses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret.token}`,
        },
        body: JSON.stringify({ status: caption }),
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "Mastodon rejected this post." };
      return { ok: true, network: "mastodon" };
    }
    const postRes = await fetch(secret.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: caption }),
      signal,
      redirect: "error",
    });
    if (!postRes.ok) return { ok: false, error: "Discord rejected this webhook." };
    return { ok: true, network: "discord" };
  } catch (error) {
    if (error instanceof Error && /timeout|aborted/i.test(error.message))
      return { ok: false, error: "That network timed out." };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "This post could not be sent.",
    };
  }
}
