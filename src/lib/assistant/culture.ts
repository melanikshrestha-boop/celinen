/** Culture hooks the model does not get from Llama 8B. No original photos. */

export type CultureHook = { id: string; title: string; needles: string[]; body: string };

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export const CULTURE_HOOKS: CultureHook[] = [
  {
    id: "dont-mind",
    title: "Kent Jones — Don't Mind (2016)",
    needles: [
      "hola",
      "como estas",
      "como esta",
      "coma estas",
      "comma estas",
      "konnichiwa",
      "konichiwa",
      "conichiwa",
      "she said",
      "sak pase",
      "bonjour madame",
      "dont mind",
      "kent jones",
    ],
    body: `Kent Jones, "Don't Mind." Hook: She said "Hola, ¿cómo estás?" / She said "Konnichiwa." / She said "Pardon my French," I said "Bonjour, Madame." / Then she said "Sak pase," and I said "N'ap boule." / No matter where I go, you know I love 'em all. Musical.ly 2016, still a greeting-stack meme. Finish the stack. Do not lecture about cultural juxtaposition.`,
  },
  {
    id: "espresso",
    title: "Sabrina Carpenter — Espresso (2024)",
    needles: ["espresso", "that's that me", "sabrina carpenter", "that's that me espresso"],
    body: `Sabrina Carpenter, "Espresso." Hook: "That's that me espresso." 2024 pop that still leaks onto sets. If they hum it, name it and keep moving.`,
  },
  {
    id: "not-like-us",
    title: "Kendrick Lamar — Not Like Us (2024)",
    needles: ["not like us", "mustarda", "a minor", "kendrick"],
    body: `Kendrick Lamar, "Not Like Us." Culture-defining 2024. If they quote it, recognize it. Don't perform the whole diss.`,
  },
  {
    id: "apt",
    title: "ROSÉ & Bruno Mars — APT. (2024)",
    needles: ["apateu", "apt", "rose bruno", "rosé"],
    body: `ROSÉ and Bruno Mars, "APT." Korean drinking-game hook that ate 2024–2025. If they say 아파트 / apateu, that's the record.`,
  },
];

export function wantsCulture(text: string) {
  const value = fold(text);
  return (
    /\b(lyric|lyrics|song|verse|chorus|finish|hola|konnichiwa|konichiwa|conichiwa|como estas|she said|fav(ou)?rite song|what song)\b/.test(
      value,
    ) || /[^\x00-\x7F]/.test(text)
  );
}

export function retrieveCulture(query: string, limit = 2): CultureHook[] {
  const hay = fold(query);
  const scored = CULTURE_HOOKS.map((hook) => {
    let hit = 0;
    for (const needle of hook.needles) if (hay.includes(needle)) hit += 1;
    return { hook, hit };
  })
    .filter((row) => row.hit >= 2 || (row.hit === 1 && row.hook.needles.some((n) => n.length > 10 && hay.includes(n))))
    .sort((a, b) => b.hit - a.hit)
    .slice(0, limit)
    .map((row) => row.hook);
  return scored;
}

export function formatCultureForPrompt(hooks: readonly CultureHook[], vibe = ""): string {
  const lines = hooks.map((hook) => `${hook.title}: ${hook.body}`);
  if (vibe.trim()) lines.push(`VIBE ${vibe.trim()}`);
  return lines.join("\n");
}

export function wantsGreeting(text: string) {
  return /^(hey|hi|hello|yo|sup|hey gang|hiya|morning|evening|what'?s up)\b/i.test(text.trim());
}

export function wantsFun(text: string) {
  return wantsCulture(text) || wantsGreeting(text);
}

const GREET_VIBES = [
  "One human line. No menus. Do not ask what's the shoot.",
  "Hi back like a person. Then wait.",
  "If they only said hi, do not pitch cull, events, or a lens.",
];

export function greetVibe(now = new Date()) {
  return GREET_VIBES[now.getUTCDate() % GREET_VIBES.length]!;
}

export type CultureBrief = { hooks: CultureHook[]; vibe: string };

const MAX_HOOKS = 8;
const MAX_NEEDLES = 24;

export function parseCultureHook(raw: unknown): CultureHook | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim().slice(0, 64) : "";
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 120) : "";
  const body = typeof row.body === "string" ? row.body.trim().slice(0, 800) : "";
  const needles = Array.isArray(row.needles)
    ? row.needles
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, MAX_NEEDLES)
    : [];
  if (!id || !title || !body) return null;
  return { id, title, needles, body };
}

/** Contract for a fun API you host: POST { q } → { hooks, vibe }. */
export function parseCultureResponse(raw: unknown): CultureBrief {
  const row =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const hooks = (Array.isArray(row.hooks) ? row.hooks : [])
    .map(parseCultureHook)
    .filter((hook): hook is CultureHook => Boolean(hook))
    .slice(0, MAX_HOOKS);
  const vibe = typeof row.vibe === "string" ? row.vibe.trim().slice(0, 240) : "";
  return { hooks, vibe };
}

export function localCultureBrief(query: string, now = new Date()): CultureBrief {
  return {
    hooks: retrieveCulture(query),
    vibe: wantsGreeting(query) ? greetVibe(now) : "",
  };
}

function mergeBrief(remote: CultureBrief, local: CultureBrief): CultureBrief {
  const seen = new Set<string>();
  const hooks: CultureHook[] = [];
  for (const hook of [...remote.hooks, ...local.hooks]) {
    if (seen.has(hook.id)) continue;
    seen.add(hook.id);
    hooks.push(hook);
    if (hooks.length >= MAX_HOOKS) break;
  }
  return { hooks, vibe: remote.vibe || local.vibe };
}

export function cultureApiUrl(env: { LENSLAB_CULTURE_API?: string } = process.env) {
  const value = env.LENSLAB_CULTURE_API?.trim() ?? "";
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Optional LENSLAB_CULTURE_API. Fail closed to bundled hooks in 800ms. */
export async function loadCulture(
  query: string,
  options: {
    fetch?: typeof fetch;
    url?: string;
    now?: Date;
    signal?: AbortSignal;
  } = {},
): Promise<CultureBrief> {
  const local = localCultureBrief(query, options.now);
  const url = options.url ?? cultureApiUrl();
  if (!url || !query.trim()) return local;
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ q: query.trim().slice(0, 400) }),
    });
    if (!response.ok) return local;
    return mergeBrief(parseCultureResponse(await response.json()), local);
  } catch {
    return local;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
