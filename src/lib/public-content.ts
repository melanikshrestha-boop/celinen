export const BLOG_CATEGORIES = [
  "All",
  "Tool Comparisons",
  "Alternatives",
  "Use Cases",
  "Guides",
  "Features",
  "Industry Insights",
] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export type FotoArticle = {
  slug: string;
  title: string;
  description: string;
  category: Exclude<BlogCategory, "All">;
  published: string;
  cover?: string;
  minutes?: number;
  draft?: boolean;
  sections: readonly { title: string; paragraphs: readonly string[] }[];
};

/** Example posts so the index has a real grid. Rewrite every word. */
export const fotoArticles: readonly FotoArticle[] = [
  {
    slug: "lightroom-vs-capture-one-2026",
    title: "Lightroom vs Capture One in 2026: what still matters after the cull",
    description:
      "A working comparison of the two editors photographers actually finish in — color, catalogs, and what to decide before you buy another seat.",
    category: "Tool Comparisons",
    published: "2026-09-10",
    cover: "/images/blog/lightroom-capture-one.jpg",
    minutes: 11,
    sections: [
      {
        title: "Start with the job, not the brand",
        paragraphs: [
          "Most “which editor is better” pieces start with feature lists. Start with the job: sports the same night, a wedding week, or a catalog you still open from 2019. The tool that wins is the one that does not fight that job.",
          "Lightroom Classic is still the default because the catalog, presets, and Publish Services are already in the muscle. Capture One is still the color tool people switch to when skin and product have to hold.",
        ],
      },
      {
        title: "What actually changes after you pick",
        paragraphs: [
          "The cull is the expensive hour. After that, you need ratings, color, and a clean handoff into the editor you already trust. Matching sliders does not mean matching pixels. Check a real file from your last shoot before you move a whole season.",
          "If you keep Adobe for finish work, FOTO is built to stay out of the way: originals stay local, and supported develop settings can go with you.",
        ],
      },
      {
        title: "A practical way to choose",
        paragraphs: [
          "Stay if your catalog, clients, and presets already live there. Switch if color is the bottleneck and you are willing to rebuild the library. Do not switch because a chart said so.",
        ],
      },
    ],
  },
  {
    slug: "send-a-gallery-the-same-night",
    title: "How to send a client gallery the same night",
    description:
      "A same-night delivery path: pick, prepare, publish. No fake speed claims — just the order of work that actually gets a gallery out.",
    category: "Guides",
    published: "2026-09-08",
    cover: "/images/blog/same-night-gallery.jpg",
    minutes: 8,
    sections: [
      {
        title: "Decide the set before you polish",
        paragraphs: [
          "Same-night galleries fail when editing starts before the set exists. Pick first. A hundred honest frames beat twenty overworked ones that never leave the laptop.",
          "Rejects are flags, not deletes. Originals stay untouched. That is the only way you can move fast without gambling the archive.",
        ],
      },
      {
        title: "Publish a copy, keep the master",
        paragraphs: [
          "The gallery is a copy you chose to send. The masters stay with you. If the client needs a change, you still have the file. If the night runs long, you can still publish what you have and follow up.",
        ],
      },
      {
        title: "What “tonight” actually requires",
        paragraphs: [
          "A machine that can import, a pick you trust, and a destination the client can open. Everything else is extra. Do not wait on a feature that is not in the path.",
        ],
      },
    ],
  },
  {
    slug: "aftershoot-imagen-and-picking-yourself",
    title: "Aftershoot, Imagen, and picking the frames yourself",
    description:
      "Where auto-cull tools help, where they flatten your eye, and why the keepers still have to be yours.",
    category: "Alternatives",
    published: "2026-09-04",
    cover: "/images/blog/picking-the-frames.jpg",
    minutes: 9,
    sections: [
      {
        title: "What those tools are for",
        paragraphs: [
          "Aftershoot and Imagen are built to shrink a huge card. Blur, blinks, near-duplicates — the mechanical misses. That work is real. It is also not the whole pick.",
          "The second you let a model choose the story of the night, the set starts to look like everyone else’s. Use them as a first pass, not as the author.",
        ],
      },
      {
        title: "Keep the decision",
        paragraphs: [
          "FOTO will surface focus and duplicate suggestions. You still mark the keepers. That is the product: help with the pile, not a replacement for your eye.",
        ],
      },
      {
        title: "A fair test",
        paragraphs: [
          "Run your last shoot through the tool you already pay for. Then pick the same shoot yourself. If the sets match, you found a shortcut. If they do not, you found the job.",
        ],
      },
    ],
  },
];

export function articlesInCategory(category: BlogCategory) {
  const live = fotoArticles.filter((article) => !article.draft);
  if (category === "All") return live;
  return live.filter((article) => article.category === category);
}

export function findFotoArticle(slug: string): FotoArticle | undefined {
  return fotoArticles.find((article) => article.slug === slug);
}

export function publicDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export const fotoReleases = [
  {
    id: "c079f4f",
    date: "2026-09-09",
    title: "Safer editing between photographs",
    description: "A more reliable handoff when you move to another photo in the same shoot.",
    changes: [
      "Develop hides stale controls while the next photograph loads, so a late gesture cannot change the wrong photo.",
      "Import registration, preparation, and durable completion are measured separately. Durable completion waits for the final saved import report.",
      "When storage fills, import stops new work, retains confirmed saves, and waits for owned work to settle before retry.",
    ],
    note: "Preparation completion includes duplicate and failed files. It does not mean every source produced a preview, and it is not a bulk RAW speed guarantee.",
  },
  {
    id: "6948a8f",
    date: "2026-09-09",
    title: "A little more sky. A clearer way in.",
    description: "A brighter public home, with a repaired workspace-history handoff.",
    changes: [
      "The public homepage, sign-in, and first-account setup use a white-and-blue design with mountain artwork and OpenAI Sans.",
      "Repaired the unavailable workspace-history error on the hosted service.",
      "If cloud history becomes unavailable, FOTO identifies a temporary conversation clearly. Retrying does not silently upload or replace that conversation.",
    ],
    note: "The public redesign does not change your private workspace theme, photos, edit history, or financial calculations.",
  },
] as const;

export function publicContentHead(title: string, description: string, path: string) {
  return {
    meta: [
      { title: `${title} — FOTO` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} — FOTO` },
      { property: "og:description", content: description },
    ],
    links: [{ rel: "canonical", href: `https://lenslab.dev${path}` }],
  };
}
