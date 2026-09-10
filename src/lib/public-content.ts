export type FotoArticle = {
  slug: string;
  title: string;
  description: string;
  category: string;
  published: string;
  sections: readonly { title: string; paragraphs: readonly string[] }[];
};

/** Original editorial content. These are workflow suggestions, not product guarantees. */
export const fotoArticles: readonly FotoArticle[] = [
  {
    slug: "a-calmer-first-pass",
    title: "A calmer first pass through a shoot",
    description: "Separate choosing photographs from finishing them, and give each pass one job.",
    category: "Workflow",
    published: "2026-09-09",
    sections: [
      {
        title: "Start with the brief",
        paragraphs: [
          "Before judging individual frames, write down what the delivery needs: the people, products, moments, and details you promised. A beautiful photograph can still miss the brief. Keep that short list beside your contact sheet so your first pass is about coverage, not perfect color.",
        ],
      },
      {
        title: "Give each pass one decision",
        paragraphs: [
          "First, mark the obvious keepers and leave uncertain frames undecided. Next, compare similar photographs together. Look for the expression, gesture, focus, and cleanest composition that support the story. Only then start the detailed edit. You can move back between passes; the point is to avoid making every decision at once.",
          "Treat a reject flag as a review decision, not a reason to erase an original. Keep your source files and a separate backup while the job is still in progress. An import preview or a finished progress bar is not a backup check.",
        ],
      },
      {
        title: "Finish a small set first",
        paragraphs: [
          "If the client needs an early selection, agree on its size and deadline before the shoot. Complete and inspect that set before polishing the full gallery. A clear first delivery is easier to manage than an open-ended promise to send everything soon.",
        ],
      },
    ],
  },
  {
    slug: "check-the-export",
    title: "Check the export, not just the preview",
    description: "A simple final check for the image your client will actually receive.",
    category: "Editing",
    published: "2026-09-09",
    sections: [
      {
        title: "Keep the comparison consistent",
        paragraphs: [
          "Choose one photograph with useful detail in the shadows, highlights, and your main subject. Finish its edit, then note the source version, crop, output dimensions, and quality setting. Comparing two different versions can make a rendering problem look like a color decision.",
        ],
      },
      {
        title: "Open the delivered file",
        paragraphs: [
          "Export a copy and reopen that file. Check the whole composition first, then inspect important details at 100%. Look for an unexpected crop, rotated image, missing adjustment, or changed brightness. Do this before exporting a large batch, not after sending the gallery.",
          "If the result differs, pause and check whether the editor and export used the same original, recipe, and processing mode. In FOTO, an image labeled Import preview is not the finished export proof. Native Develop processing requires the local engine; a hosted page alone does not provide it.",
        ],
      },
      {
        title: "Make the handoff traceable",
        paragraphs: [
          "Keep the approved export separate from your originals and working drafts. Use a clear delivery name and inspect the downloaded client copy where possible. Different screens and viewing applications can still look different, so an exact file check and a visual check answer different questions.",
        ],
      },
    ],
  },
  {
    slug: "a-clear-client-handoff",
    title: "A clear client handoff",
    description: "Tell your client what is ready, what happens next, and where to find it.",
    category: "Client experience",
    published: "2026-09-09",
    sections: [
      {
        title: "Agree on the destination",
        paragraphs: [
          "Ask who will receive the photographs and who will approve them. For a team, those may be different people. Confirm the delivery date, intended use, required sizes, and whether the link should be private. Put those answers with the shoot instead of relying on a scattered message thread.",
        ],
      },
      {
        title: "Send one useful message",
        paragraphs: [
          "A delivery note can be short: identify the shoot, say what is ready, share the correct link, and name the next action. If the gallery is a proofing selection rather than the final delivery, say so. Include a selection deadline only when you have agreed on one.",
          "Before sending, open the link in a signed-out window and check the access rules you intended. Confirm that downloads work when they should and that private work is not visible when it should not be. Publishing a gallery and successfully sending a message are separate steps.",
        ],
      },
      {
        title: "Close the loop",
        paragraphs: [
          "Ask for a brief receipt confirmation and record any remaining decisions with the shoot. Keep payment status separate from delivery status: a sent invoice is not a collected payment, and a downloaded gallery is not approval of every image. That distinction keeps the next conversation simple.",
        ],
      },
    ],
  },
];

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
