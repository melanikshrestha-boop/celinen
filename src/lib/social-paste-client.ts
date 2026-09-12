import { hasPasteSecret, readPasteSecrets, type PasteSocialId } from "./social-paste";
import type { PastePostResult } from "./social-paste-post";

export async function publishPastePost(
  scope: string,
  id: PasteSocialId,
  caption: string,
): Promise<PastePostResult> {
  const secrets = await readPasteSecrets(scope);
  const secret = secrets[id];
  if (!hasPasteSecret(secrets, id) || !secret)
    return { ok: false, error: "Connect this account first." };
  try {
    const response = await fetch("/__social/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, caption }),
      cache: "no-store",
    });
    if (response.status !== 404) {
      const body = (await response.json()) as PastePostResult;
      if (body && "ok" in body) return body;
      return { ok: false, error: "This post could not be sent." };
    }
  } catch {
    /* Fall through to the hosted function when the local bridge is absent. */
  }
  const { postPasteNetworkFn } = await import("./social-paste.functions");
  return postPasteNetworkFn({ data: { secret, caption } });
}
