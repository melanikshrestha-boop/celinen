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

export function formatCultureForPrompt(hooks: readonly CultureHook[]): string {
  if (!hooks.length) return "";
  return hooks.map((hook) => `${hook.title}: ${hook.body}`).join("\n");
}
