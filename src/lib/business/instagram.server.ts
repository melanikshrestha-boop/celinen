import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { businessDatabase } from "./database.server";

export const stateHash = (s: string) => createHash("sha256").update(s).digest("hex");
function config() {
  const id = process.env["INSTAGRAM_APP_ID"],
    secret = process.env["INSTAGRAM_APP_SECRET"],
    origin = process.env["PUBLISH_ORIGIN"],
    key = process.env["SOCIAL_TOKEN_KEY"];
  if (!id || !secret || !origin || !key || !/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error("Instagram needs its app connection configured in Celinen hosting settings.");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Instagram needs a secure, configured public website address.");
  return { id, secret, redirect: `${url.origin}/publish`, key: Buffer.from(key, "hex") };
}
export function instagramConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
export function sealToken(token: string, owner: string, key: Buffer) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(owner));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64");
}
export function openToken(encrypted: string, owner: string, key: Buffer) {
  const bytes = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
export async function instagramRequest(
  path: string,
  token: string,
  body?: URLSearchParams,
  request: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9_/?=&,%.-]+$/.test(path)) throw new Error("Invalid Instagram request.");
  const response = await request(
    `https://graph.instagram.com/${process.env["INSTAGRAM_API_VERSION"] || "v23.0"}/${path}`,
    {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}` },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Instagram is busy. Try again later."
        : "Instagram did not accept this request. Check account permission and image requirements.",
    );
  return (await response.json()) as {
    id?: unknown;
    user_id?: unknown;
    username?: unknown;
    status_code?: unknown;
    permalink?: unknown;
    account_type?: unknown;
  };
}
export async function startInstagram(owner: string) {
  const c = config(),
    db = businessDatabase(),
    state = randomBytes(32).toString("base64url");
  await db
    .from("social_oauth_states")
    .delete()
    .eq("owner_id", owner)
    .lt("expires_at", new Date().toISOString());
  const { count, error: countError } = await db
    .from("social_oauth_states")
    .select("hash", { count: "exact", head: true })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 5)
    throw new Error("Too many connection attempts. Wait ten minutes and retry.");
  const { error } = await db.from("social_oauth_states").insert({
    hash: stateHash(state),
    owner_id: owner,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (error) throw new Error("Instagram connection storage is unavailable.");
  const query = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish",
    state,
    enable_fb_login: "0",
    force_authentication: "1",
  });
  return `https://www.instagram.com/oauth/authorize?${query}`;
}
export async function finishInstagram(owner: string, code: string, state: string) {
  const c = config(),
    db = businessDatabase();
  const { data: consumed, error } = await db
    .from("social_oauth_states")
    .delete()
    .eq("hash", stateHash(state))
    .eq("owner_id", owner)
    .gt("expires_at", new Date().toISOString())
    .select("hash")
    .maybeSingle();
  if (error || !consumed)
    throw new Error("This connection link expired or was already used. Connect Instagram again.");
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      grant_type: "authorization_code",
      redirect_uri: c.redirect,
      code,
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  }).catch(() => {
    throw new Error("Instagram connection was interrupted. Please reconnect.");
  });
  if (!response.ok) throw new Error("Instagram could not complete the connection. Connect again.");
  const payload = await response.json();
  const short = Array.isArray(payload.data) ? payload.data[0] : payload;
  if (!short || typeof short !== "object") throw new Error("Instagram did not grant access.");
  if (typeof short.access_token !== "string") throw new Error("Instagram did not grant access.");
  const tokenUrl = new URL("https://graph.instagram.com/access_token");
  tokenUrl.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: c.secret,
    access_token: short.access_token,
  }).toString();
  const exchange = await fetch(tokenUrl, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  }).catch(() => {
    throw new Error("Instagram connection was interrupted. Please reconnect.");
  });
  if (!exchange.ok)
    throw new Error("Instagram could not save a lasting connection. Please reconnect.");
  const long = await exchange.json();
  if (
    typeof long.access_token !== "string" ||
    typeof long.expires_in !== "number" ||
    long.expires_in < 60
  )
    throw new Error("Instagram returned invalid access.");
  const profile = await instagramRequest("me?fields=user_id,username", long.access_token);
  if (!/^\d+$/.test(String(profile.user_id)) || typeof profile.username !== "string")
    throw new Error("Instagram account could not be verified.");
  const saved = await db.from("social_connections").upsert({
    owner_id: owner,
    account_id: String(profile.user_id),
    username: profile.username,
    credential: sealToken(long.access_token, owner, c.key),
    expires_at: new Date(Date.now() + Math.min(long.expires_in, 5184000) * 1000).toISOString(),
  });
  if (saved.error)
    throw new Error("Instagram connected but could not be saved. Reconnect to try again.");
  return { username: profile.username };
}
export async function instagramConnection(owner: string) {
  const { data, error } = await businessDatabase()
    .from("social_connections")
    .select("account_id,username,credential,expires_at")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) throw new Error("Instagram connection storage is unavailable.");
  return data;
}
export async function instagramCredential(owner: string, accountId: string) {
  const row = await instagramConnection(owner);
  if (!row || row.account_id !== accountId || Date.parse(row.expires_at) < Date.now() + 60000)
    throw new Error("Reconnect the original Instagram account before publishing this draft.");
  return openToken(row.credential, owner, config().key);
}
