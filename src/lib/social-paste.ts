/** Encrypted paste credentials for networks that allow it. Never Meta/TikTok OAuth. */
import type { SocialId } from "./social-accounts";

export const PASTE_SOCIAL_IDS = ["bluesky", "mastodon", "discord"] as const;
export type PasteSocialId = (typeof PASTE_SOCIAL_IDS)[number];

export type BlueskySecret = { id: "bluesky"; handle: string; appPassword: string };
export type MastodonSecret = { id: "mastodon"; instance: string; token: string };
export type DiscordSecret = { id: "discord"; webhook: string };
export type PasteSecret = BlueskySecret | MastodonSecret | DiscordSecret;

const STORE = "celinen.social.secrets.v1";
const MAX_CAPTION = 2_000;

export function isPasteSocial(id: string): id is PasteSocialId {
  return (PASTE_SOCIAL_IDS as readonly string[]).includes(id);
}

function bytesToB64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text);
}
function b64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function keyFor(scope: string) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`celinen.social.secrets.aes:${scope}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function noControl(value: string) {
  return ![...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
}

export function parseBlueskyHandle(value: string) {
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (!handle || handle.length > 253 || !noControl(handle))
    throw new Error("Enter a Bluesky handle.");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handle)) return handle;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(handle))
    throw new Error("Enter a Bluesky handle.");
  return handle;
}

export function parseBlueskyAppPassword(value: string) {
  const password = value.trim();
  if (password.length < 8 || password.length > 128 || !noControl(password) || /\s/.test(password))
    throw new Error("Enter a Bluesky app password.");
  return password;
}

export function parseMastodonInstance(value: string) {
  const raw = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!raw || raw.length > 253 || !noControl(raw)) throw new Error("Enter a Mastodon instance.");
  if (raw === "localhost" || raw.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(raw) || raw.includes(":"))
    throw new Error("Enter a public Mastodon host.");
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw))
    throw new Error("Enter a Mastodon instance.");
  return `https://${raw}`;
}

export function parseMastodonToken(value: string) {
  const token = value.trim();
  if (token.length < 20 || token.length > 256 || !/^[A-Za-z0-9._~+/-]+$/.test(token))
    throw new Error("Enter a Mastodon access token.");
  return token;
}

export function parseDiscordWebhook(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a Discord webhook URL.");
  }
  if (url.protocol !== "https:") throw new Error("Enter a Discord webhook URL.");
  if (url.username || url.password || url.hash) throw new Error("Enter a Discord webhook URL.");
  const host = url.hostname.toLowerCase();
  if (host !== "discord.com" && host !== "discordapp.com") throw new Error("Enter a Discord webhook URL.");
  const match = /^\/api\/webhooks\/(\d{16,20})\/([A-Za-z0-9_-]{20,200})$/.exec(url.pathname);
  if (!match) throw new Error("Enter a Discord webhook URL.");
  return `https://${host}/api/webhooks/${match[1]}/${match[2]}`;
}

export function parsePasteSecret(id: PasteSocialId, fields: Record<string, string>): PasteSecret {
  if (id === "bluesky")
    return {
      id,
      handle: parseBlueskyHandle(fields.handle ?? ""),
      appPassword: parseBlueskyAppPassword(fields.appPassword ?? ""),
    };
  if (id === "mastodon")
    return {
      id,
      instance: parseMastodonInstance(fields.instance ?? ""),
      token: parseMastodonToken(fields.token ?? ""),
    };
  return { id, webhook: parseDiscordWebhook(fields.webhook ?? "") };
}

export function clipPasteCaption(text: string, id: PasteSocialId) {
  const limit = id === "bluesky" ? 300 : id === "mastodon" ? 500 : MAX_CAPTION;
  const value = text.trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export async function readPasteSecrets(scope: string): Promise<Partial<Record<PasteSocialId, PasteSecret>>> {
  try {
    const packed = localStorage.getItem(`${STORE}:${scope}`);
    if (!packed) return {};
    const [ivB64, dataB64] = packed.split(".");
    if (!ivB64 || !dataB64) return {};
    const key = await keyFor(scope);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(dataB64),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as PasteSecret[];
    if (!Array.isArray(parsed)) return {};
    const out: Partial<Record<PasteSocialId, PasteSecret>> = {};
    for (const row of parsed) {
      if (!row || !isPasteSocial(row.id)) continue;
      out[row.id] = parsePasteSecret(
        row.id,
        row.id === "bluesky"
          ? { handle: row.handle, appPassword: row.appPassword }
          : row.id === "mastodon"
            ? { instance: row.instance, token: row.token }
            : { webhook: row.webhook },
      );
    }
    return out;
  } catch {
    return {};
  }
}

async function writePasteSecrets(scope: string, secrets: Partial<Record<PasteSocialId, PasteSecret>>) {
  const rows = PASTE_SOCIAL_IDS.map((id) => secrets[id]).filter((row): row is PasteSecret => Boolean(row));
  if (!rows.length) {
    localStorage.removeItem(`${STORE}:${scope}`);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("celinen:socials"));
    return;
  }
  const key = await keyFor(scope);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(rows)),
  );
  localStorage.setItem(`${STORE}:${scope}`, `${bytesToB64(iv)}.${bytesToB64(data)}`);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("celinen:socials"));
}

export async function savePasteSecret(scope: string, secret: PasteSecret) {
  const current = await readPasteSecrets(scope);
  current[secret.id] = secret;
  await writePasteSecrets(scope, current);
}

export async function deletePasteSecret(scope: string, id: PasteSocialId) {
  const current = await readPasteSecrets(scope);
  delete current[id];
  await writePasteSecrets(scope, current);
}

export function hasPasteSecret(
  secrets: Partial<Record<PasteSocialId, PasteSecret>>,
  id: SocialId,
): id is PasteSocialId {
  return isPasteSocial(id) && Boolean(secrets[id]);
}
