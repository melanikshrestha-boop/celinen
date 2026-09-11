/** Local social connections. AES-GCM at rest. No passwords. No fake live posts. */

/** Picker order matches the add-channel sheet: IG → Facebook → X → LinkedIn → Pinterest → Bluesky → Threads → TikTok → YouTube Shorts → Google Business → Mastodon → Discord → WooCommerce. */
export const SOCIAL_NETWORKS = [
  { id: "instagram", title: "Instagram", kind: "Social" },
  { id: "facebook", title: "Facebook", kind: "Social" },
  { id: "x", title: "X (Twitter)", kind: "Social" },
  { id: "linkedin", title: "LinkedIn", kind: "Social" },
  { id: "pinterest", title: "Pinterest", kind: "Social" },
  { id: "bluesky", title: "Bluesky", kind: "Social" },
  { id: "threads", title: "Threads", kind: "Social" },
  { id: "tiktok", title: "TikTok", kind: "Social" },
  { id: "youtube-shorts", title: "YouTube Shorts", kind: "Social" },
  { id: "google-business", title: "Google Business", kind: "Social" },
  { id: "mastodon", title: "Mastodon", kind: "Social" },
  { id: "discord", title: "Discord", kind: "Community" },
  { id: "woocommerce", title: "WooCommerce", kind: "Ecommerce" },
] as const;

export type SocialId = (typeof SOCIAL_NETWORKS)[number]["id"];
export type SocialLink = { id: SocialId; at: number };

const STORE = "celinen.social.links.v1";
const SHOWN = 4;

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
    new TextEncoder().encode(`celinen.social.aes:${scope}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function readSocialLinks(scope: string): Promise<SocialLink[]> {
  try {
    const packed = localStorage.getItem(`${STORE}:${scope}`);
    if (!packed) return [];
    const [ivB64, dataB64] = packed.split(".");
    if (!ivB64 || !dataB64) return [];
    const key = await keyFor(scope);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(dataB64),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as SocialLink[];
    const allowed = new Set(SOCIAL_NETWORKS.map((item) => item.id));
    return Array.isArray(parsed)
      ? parsed.filter((row) => row && allowed.has(row.id) && Number.isFinite(row.at))
      : [];
  } catch {
    return [];
  }
}

export async function writeSocialLinks(scope: string, links: SocialLink[]) {
  const key = await keyFor(scope);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(links.slice(0, SOCIAL_NETWORKS.length))),
  );
  localStorage.setItem(`${STORE}:${scope}`, `${bytesToB64(iv)}.${bytesToB64(data)}`);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("celinen:socials"));
}

export function shownSocials(links: SocialLink[]) {
  return links.slice(0, SHOWN);
}

export function isSocialConnected(links: SocialLink[], id: SocialId) {
  return links.some((row) => row.id === id);
}

export async function connectSocial(scope: string, id: SocialId) {
  const links = await readSocialLinks(scope);
  if (isSocialConnected(links, id)) return links;
  const next = [{ id, at: Date.now() }, ...links];
  await writeSocialLinks(scope, next);
  return next;
}

export async function disconnectSocial(scope: string, id: SocialId) {
  const next = (await readSocialLinks(scope)).filter((row) => row.id !== id);
  await writeSocialLinks(scope, next);
  return next;
}
