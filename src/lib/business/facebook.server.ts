import { randomBytes } from "node:crypto";
import { z } from "zod";
import { businessDatabase } from "./database.server";
import { openToken, sealToken, stateHash } from "./instagram.server";

const pageSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().max(300),
  access_token: z.string().min(1).max(8000),
  tasks: z.array(z.string()).optional(),
});
const pagesSchema = z.array(pageSchema).max(100);
function config() {
  const id = process.env["FACEBOOK_APP_ID"],
    secret = process.env["FACEBOOK_APP_SECRET"],
    origin = process.env["PUBLISH_ORIGIN"],
    key = process.env["SOCIAL_TOKEN_KEY"];
  const version = process.env["FACEBOOK_API_VERSION"] || "v23.0";
  if (
    !id ||
    !secret ||
    !origin ||
    !key ||
    !/^[a-fA-F0-9]{64}$/.test(key) ||
    !/^v\d+\.0$/.test(version)
  )
    throw new Error("Facebook needs its app connection configured in hosting settings.");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Facebook needs a secure public website address.");
  return {
    id,
    secret,
    redirect: `${url.origin}/publish?connector=facebook`,
    key: Buffer.from(key, "hex"),
    version,
  };
}
export function facebookConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
export async function facebookRequest(
  path: string,
  token: string,
  body?: URLSearchParams,
  request: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9_/?=&,%.-]+$/.test(path) || path.includes(".."))
    throw new Error("Invalid Facebook request.");
  const version = process.env["FACEBOOK_API_VERSION"] || "v23.0";
  if (!/^v\d+\.0$/.test(version)) throw new Error("Invalid Facebook API version.");
  const response = await request(`https://graph.facebook.com/${version}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}` },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Facebook is busy. Try later."
        : "Facebook did not accept the request. Check Page publishing permissions.",
    );
  return (await response.json()) as {
    id?: unknown;
    post_id?: unknown;
    success?: unknown;
    data?: unknown;
    paging?: unknown;
  };
}
export async function startFacebook(owner: string) {
  const c = config(),
    db = businessDatabase(),
    state = randomBytes(32).toString("base64url");
  await db
    .from("social_oauth_states")
    .delete()
    .eq("owner_id", owner)
    .lt("expires_at", new Date().toISOString());
  const { count, error } = await db
    .from("social_oauth_states")
    .select("hash", { count: "exact", head: true })
    .eq("owner_id", owner);
  if (error || (count ?? 0) >= 5)
    throw new Error("Too many connection attempts. Wait ten minutes.");
  const saved = await db.from("social_oauth_states").insert({
    hash: stateHash(`facebook:${state}`),
    owner_id: owner,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (saved.error) throw new Error("Facebook connection storage is unavailable.");
  return `https://www.facebook.com/${c.version}/dialog/oauth?${new URLSearchParams({ client_id: c.id, redirect_uri: c.redirect, response_type: "code", scope: "pages_show_list,pages_read_engagement,pages_manage_posts", state })}`;
}
export async function finishFacebook(owner: string, code: string, state: string) {
  const c = config(),
    db = businessDatabase();
  const consumed = await db
    .from("social_oauth_states")
    .delete()
    .eq("hash", stateHash(`facebook:${state}`))
    .eq("owner_id", owner)
    .gt("expires_at", new Date().toISOString())
    .select("hash")
    .maybeSingle();
  if (consumed.error || !consumed.data)
    throw new Error("Facebook connection expired. Connect again.");
  const response = await fetch(`https://graph.facebook.com/${c.version}/oauth/access_token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      redirect_uri: c.redirect,
      code,
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Facebook could not complete the connection.");
  const token = await response.json();
  if (
    typeof token.access_token !== "string" ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in < 60
  )
    throw new Error("Facebook returned invalid access.");
  const result = await facebookRequest(
    "me/accounts?fields=id,name,access_token,tasks&limit=100",
    token.access_token,
  );
  const pages = pagesSchema
    .parse(result.data)
    .filter((page) =>
      page.tasks?.some((task) =>
        [
          "CREATE_CONTENT",
          "MANAGE",
          "PROFILE_PLUS_CREATE_CONTENT",
          "PROFILE_PLUS_FULL_CONTROL",
        ].includes(task),
      ),
    );
  if (!pages.length)
    throw new Error(
      "No Facebook Pages with publishing permission were granted. Personal-profile Stories are not supported by this connection.",
    );
  const saved = await db.from("facebook_social_connections").upsert({
    owner_id: owner,
    pages_credential: sealToken(JSON.stringify(pages), `facebook:${owner}`, c.key),
    selected_page_id: null,
    expires_at: new Date(Date.now() + Math.min(token.expires_in, 5184000) * 1000).toISOString(),
  });
  if (saved.error)
    throw new Error(
      "Could not save Facebook access. Apply the social connection migration and reconnect.",
    );
  return { connected: true };
}
async function connection(owner: string) {
  const result = await businessDatabase()
    .from("facebook_social_connections")
    .select("pages_credential,selected_page_id,expires_at")
    .eq("owner_id", owner)
    .maybeSingle();
  if (result.error) throw new Error("Facebook connection storage needs setup.");
  const row = result.data;
  if (!row) return null;
  return {
    pages: pagesSchema.parse(
      JSON.parse(openToken(row.pages_credential, `facebook:${owner}`, config().key)),
    ),
    selected: row.selected_page_id as string | null,
    expiresAt: row.expires_at as string,
  };
}
export async function facebookStatus(owner: string) {
  if (!facebookConfigured()) return { configured: false, pages: [], selected: null, active: false };
  const value = await connection(owner);
  return {
    configured: true,
    pages: value?.pages.map((page) => ({ id: page.id, name: page.name })) ?? [],
    selected: value?.selected ?? null,
    active: !!value?.selected && Date.parse(value.expiresAt) > Date.now() + 60000,
  };
}
export async function selectFacebookPage(owner: string, id: string) {
  const value = await connection(owner);
  if (
    !value?.pages.some((page) => page.id === id) ||
    Date.parse(value.expiresAt) <= Date.now() + 60000
  )
    throw new Error("Reconnect Facebook and choose an authorized Page.");
  const saved = await businessDatabase()
    .from("facebook_social_connections")
    .update({ selected_page_id: id })
    .eq("owner_id", owner);
  if (saved.error) throw new Error("Could not select this Page.");
  return { selected: id };
}
export async function facebookCredential(owner: string, pageId: string) {
  const value = await connection(owner),
    page = value?.pages.find((page) => page.id === pageId);
  if (
    !value ||
    !page ||
    value.selected !== pageId ||
    Date.parse(value.expiresAt) <= Date.now() + 60000
  )
    throw new Error(
      "Reconnect and select the original Facebook Page before retrying this publication.",
    );
  return page.access_token;
}
export async function disconnectFacebook(owner: string) {
  const result = await businessDatabase()
    .from("facebook_social_connections")
    .delete()
    .eq("owner_id", owner);
  if (result.error) throw new Error("Could not disconnect Facebook.");
  return { disconnected: true };
}
