/** Server-side paste posts. Secrets are not stored here. One attempt; no retry. */
import {
  clipPasteCaption,
  parsePasteSecret,
  type PasteSecret,
  type PasteSocialId,
} from "./social-paste";

const TIMEOUT_MS = 20_000;

export type PastePostResult = { ok: true; network: PasteSocialId } | { ok: false; error: string };

function asSecret(value: unknown): PasteSecret {
  if (!value || typeof value !== "object") throw new Error("Connect this account first.");
  const row = value as PasteSecret;
  if (row.id === "bluesky")
    return parsePasteSecret("bluesky", { handle: row.handle, appPassword: row.appPassword });
  if (row.id === "mastodon")
    return parsePasteSecret("mastodon", { instance: row.instance, token: row.token });
  if (row.id === "discord") return parsePasteSecret("discord", { webhook: row.webhook });
  if (row.id === "x") return parsePasteSecret("x", { token: row.token });
  if (row.id === "linkedin") return parsePasteSecret("linkedin", { token: row.token });
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

export type PasteImage = { mime: string; bytes: Uint8Array };

export async function postPasteNetwork(input: {
  secret: unknown;
  caption: string;
  image?: PasteImage | undefined;
}): Promise<PastePostResult> {
  try {
    const secret = asSecret(input.secret);
    const caption = clipPasteCaption(String(input.caption ?? ""), secret.id);
    if (!caption) return { ok: false, error: "Write a caption first." };
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const image = input.image && input.image.bytes.length ? input.image : undefined;
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
      let embed: Record<string, unknown> | undefined;
      if (image) {
        const blobRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
          method: "POST",
          headers: {
            "content-type": image.mime === "image/png" ? "image/png" : "image/jpeg",
            authorization: `Bearer ${session.accessJwt}`,
          },
          body: image.bytes,
          signal,
          redirect: "error",
        });
        const blob = await readJson(blobRes);
        if (!blobRes.ok || !blob.blob) return { ok: false, error: "Bluesky could not take this photo." };
        embed = {
          $type: "app.bsky.embed.images",
          images: [{ alt: caption.slice(0, 100), image: blob.blob }],
        };
      }
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
            ...(embed ? { embed } : {}),
          },
        }),
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "Bluesky rejected this post." };
      return { ok: true, network: "bluesky" };
    }
    if (secret.id === "mastodon") {
      const mediaIds: string[] = [];
      if (image) {
        const body = new FormData();
        body.set("file", new Blob([image.bytes], { type: image.mime || "image/jpeg" }), "photo.jpg");
        const mediaRes = await fetch(`${secret.instance}/api/v2/media`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret.token}` },
          body,
          signal,
          redirect: "error",
        });
        const media = await readJson(mediaRes);
        if (!mediaRes.ok || typeof media.id !== "string")
          return { ok: false, error: "Mastodon could not take this photo." };
        mediaIds.push(media.id);
      }
      const postRes = await fetch(`${secret.instance}/api/v1/statuses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret.token}`,
        },
        body: JSON.stringify({ status: caption, ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "Mastodon rejected this post." };
      return { ok: true, network: "mastodon" };
    }
    if (secret.id === "x") {
      const postRes = await fetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret.token}`,
        },
        body: JSON.stringify({ text: caption }),
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "X rejected this post." };
      return { ok: true, network: "x" };
    }
    if (secret.id === "linkedin") {
      const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { authorization: `Bearer ${secret.token}` },
        signal,
        redirect: "error",
      });
      const me = await readJson(meRes);
      const sub = typeof me.sub === "string" ? me.sub : "";
      if (!meRes.ok || !sub) return { ok: false, error: "LinkedIn could not read this token." };
      const postRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret.token}`,
          "x-restli-protocol-version": "2.0.0",
        },
        body: JSON.stringify({
          author: `urn:li:person:${sub}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: caption },
              shareMediaCategory: "NONE",
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "LinkedIn rejected this post." };
      return { ok: true, network: "linkedin" };
    }
    if (image) {
      const body = new FormData();
      body.set("payload_json", JSON.stringify({ content: caption }));
      body.set("files[0]", new Blob([image.bytes], { type: image.mime || "image/jpeg" }), "photo.jpg");
      const postRes = await fetch(secret.webhook, {
        method: "POST",
        body,
        signal,
        redirect: "error",
      });
      if (!postRes.ok) return { ok: false, error: "Discord rejected this webhook." };
      return { ok: true, network: "discord" };
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
