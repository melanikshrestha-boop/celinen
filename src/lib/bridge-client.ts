import { getBridgeCredentials, type BridgeCredentials } from "@/lib/lightroom.functions";

let cached: BridgeCredentials | null = null;
let pending: Promise<BridgeCredentials> | null = null;

/** Bridge credentials for the signed-in studio (cached for the session). */
export async function bridgeCredentials(): Promise<BridgeCredentials> {
  if (cached) return cached;
  if (!pending) {
    pending = getBridgeCredentials()
      .then((creds) => {
        cached = creds;
        return creds;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** fetch() against the Lightroom bridge with the studio's token attached. */
export async function bridgeFetch(url: string, init: RequestInit = {}) {
  const { workspace, token } = await bridgeCredentials();
  const target = new URL(url, window.location.origin);
  if (!target.searchParams.has("workspace")) target.searchParams.set("workspace", workspace);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(target.toString(), { ...init, headers });
}
