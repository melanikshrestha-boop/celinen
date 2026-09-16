import { PRODUCT_NAME } from "./product";

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
  sections: readonly {
    title: string;
    paragraphs: readonly string[];
    items?: readonly string[];
  }[];
};

/** Example posts so the index has a real grid. Rewrite every word. */
export const fotoArticles: readonly FotoArticle[] = [
  {
    slug: "sports-photographer-genie",
    title: "The sports photographer’s genie: camera to money",
    description:
      "The real job is not editing. It is the interval between the shutter and the right photograph in front of the right person. Ten wishes, in order. Tell us which ones hurt.",
    category: "Industry Insights",
    published: "2026-09-10",
    cover: "/images/blog/sports-genie.jpg",
    minutes: 16,
    sections: [
      {
        title: "The interval, not the slider",
        paragraphs: [
          "The biggest sports-photography problem is not editing by itself. It is everything between pressing the shutter and getting the correct photograph in front of the correct person.",
          "A sports photographer can shoot 3,000 to 9,000 frames in one game, often in long bursts where only one or two frames hold the peak. A club, a wire desk, a social manager, an athlete, a parent, or a buyer may want those frames during the match, at half-time, and right after the whistle. Photographers on public forums describe 6,000–8,000 RAW files from a football match while the club is already asking for pictures.",
          "If the genie wish is one sentence: I want to press the shutter, and I want the right photos identified, edited like me, labeled with the right athlete and event, backed up, delivered to the right person, and sold or published within minutes — without sitting at a computer.",
          "That is bigger than an AI culling product. It is bigger than a slightly better Aftershoot. The rest of this note is the wish list underneath that sentence. FOTO is building toward it. We do not pretend the genie is shipped. Leave a comment at the bottom — what you like, what you hate, what to build next.",
        ],
      },
      {
        title: "1. Ready the second I shoot",
        paragraphs: [
          "The luxury workflow is shoot, go home, import, cull, edit, export, upload. Professional sports often looks like: shoot, transmit, an editor sees it in seconds, crop and caption, publish. Camera Bits has described Associated Press sports desks where frames arrive from the sideline within seconds and move through identify, tone, metadata, and the wire.",
          "Speed is money. One race photographer reported more than ten hours to get 5,000+ photos online while a competitor put up about 8,000 in under an hour, and estimated the delay cost most of the sales. That is one person’s night, not a lab study. It is still the market.",
          "Genie: everything I shoot is already online before I pack the camera. FOTO today: pick, then send a gallery the same night. The camera-to-desk live path is the larger build.",
        ],
      },
      {
        title: "2. Find THE frame. Don’t make me inspect 8,000.",
        paragraphs: [
          "Culling is keep or reject. Sports bursts are not duplicates. They are different milliseconds: approaching, foot down, both feet off, better face, eyes closing, defender in the way. Aftershoot’s sports notes talk about 3,000–5,000-frame jobs where only dozens of moments matter, and about grouping bursts, focus, expressions, peak action.",
          "Photographers still say current AI cull is built for portraits and weddings. A Lightroom user shooting running events wanted the frame where both of the runner’s feet are off the ground — and still walked the burst by hand. That is the product insight. Sharp versus blurry is table stakes. The wish is: which frame is the sports moment I would pick?",
        ],
        items: [
          "Ball on bat, ball leaving the fingertips, dunk at the peak, catch, keeper contacting the ball",
          "Runner airborne, swimmer breaking water, collision, celebration, reaction, win or loss",
          "Clean background, unobstructed face, eyes visible, the important player, the important play",
        ],
      },
      {
        title: "3. Tell me WHO is in every photo",
        paragraphs: [
          "Once you sell to individual athletes, identity is the product. A marathon is 4,000 runners and 80,000 pictures. The buyer does not want Gallery → 80,000 photographs → scroll. They want Melani Shrestha → 47 photos of Melani.",
          "Motorsports photographers describe customers who cannot find themselves in 1,000+ frames, and the extra job of tagging by hand. PhotoDay sells FaceFind for high-volume sports. Photo Mechanic lets you type jersey shorthand and expand it into name, team, position. Demand is already paid for.",
          "The large version combines face, jersey, bib, OCR, roster, kit colour, event timing, camera position. Then #23 is Jane Doe, USC, women’s soccer, 34th minute, without you typing it.",
          "Genie: every photo already knows who is in it. FOTO today: a shoot roster, jersey/bib tags in Studio, Find my photos on the gallery. Faces are counted for cull. Faces are not named. That next layer stays local — not a shared face model trained on other photographers’ work.",
        ],
      },
      {
        title: "4. Make 4,000 photos look like I edited them",
        paragraphs: [
          "Stadium light is not a preset. Sun, cloud, shade, LED arenas, two bodies, two lenses, ISO walking, white balance drifting. Aftershoot’s own sports-editing notes call out mixed light, colour casts, batch consistency, and sharpening.",
          "The wish is not “apply one look to 4,000 files.” It is: make 4,000 different files converge on my style. One needs +0.7. One is fine. One needs white balance. One a tighter crop. One lifted shadows. One a levelled horizon. The gallery still has to feel like one photographer.",
          "Genie: learn how I edit so I never batch-edit again. FOTO today: a look you save stays with your work. It is not a shared model. Per-frame style is the harder engine.",
        ],
      },
      {
        title: "5. Stop making me move files",
        paragraphs: [
          "Camera → card → reader → SSD → Photo Mechanic → Lightroom → Photoshop → export folder → cloud → gallery → social → client. Every hop is latency. Photographers describe editing off the SD card during football because Instagram wants pictures during the match. Others report ~40 minutes to export 2,500 JPEGs from Lightroom on a fast laptop.",
          "Genie: the photograph is never imported, exported, or uploaded. Camera → system. Everything after that reads the same asset. FOTO today: originals stay on your machine; a gallery is a copy you chose to send. The live ingest path is not “we already ate the card.”",
        ],
      },
      {
        title: "6. Give every athlete their own gallery",
        paragraphs: [
          "One tournament, 40 teams, 600 athletes, 30,000 usable frames. You should not sit and manufacture Team A, Team B, Player A, Player B by hand. Teams often want everything. Players want photographs that contain them.",
          "Genie: Event → USC → #12, generated without you filing. Identification feeds this. Without who-is-in-the-photo, automatic collections are fiction.",
        ],
      },
      {
        title: "7. Sell my photos for me",
        paragraphs: [
          "High-volume sports turns the photographer into salesperson, store, marketer, gallery admin, support, and fulfillment. Motorsport photographers argue in public about charging the organiser, shooting free and selling, charging athletes, or mixing models — and whether the money covers the work.",
          "The genie notices: John opened his gallery four times, favourited eight, bought nothing — and sends a real offer, not a fake countdown. Emma bought five singles; the complete set is one click more. Pricing, bundles, prints, team packages, sponsor sets.",
          "Genie: turn every frame into the most revenue without making me run a shop. FOTO today: Stripe books for invoices and collected payments. A print lab and an in-gallery store are not this path yet. We will not invent one in copy.",
        ],
      },
      {
        title: "8. Never lose a photograph",
        paragraphs: [
          "Thousands of files, fast ingest, easy to format the wrong card. Camera Bits describes event ingest that copies to editors and to backup as soon as the card is in. The photographer should not have to ask whether the card copied, the folder uploaded, or the checksum passed.",
          "Genie: losing a photograph is practically impossible — local copy, second copy, integrity check, optional cloud, card verify. FOTO today: originals stay local; a published gallery is not a backup of the shoot. That sentence stays true.",
        ],
      },
      {
        title: "9. Caption and tag everything",
        paragraphs: [
          "Editorial work wants photographer, copyright, event, place, team, player, caption, keywords — IPTC so the fields travel with the file. Photo Mechanic’s sports workflow exists because typing that by hand is slow. Code replacements turn shorthand into a full name and team.",
          "Genie: look at the picture and write “Jane Doe (23) of USC celebrates after scoring against UCLA in the second half.” FOTO today: roster plus jersey/bib shorthand on the frame, the same habit as code replacement. Automatic captions from the pixels are the next writer, not a silent lie in the sidecar.",
        ],
      },
      {
        title: "10. Google Search for every photograph I’ve ever taken",
        paragraphs: [
          "Fifteen-year archives are where strong sports frames go to hide. The wish is not another folder tree. It is: show me every photograph of #23 scoring against UCLA with her face visible and a defender in frame. Best verticals with empty sky for a magazine slug. Night celebrations, red kits.",
          "Genie: search a career the way you search the web. No keywords as a second job. That archive only works if identity, moment, and style were understood when the shutter fired.",
        ],
      },
      {
        title: "What we would actually build",
        paragraphs: [
          "Not “AI photo culling.” Not “Aftershoot, but ours.” Camera → money / publication. You shoot. The system watches.",
          "Ingest. Understand the sport and the play. Cull the burst for the moment, not the blur. Edit like you. Identify the athlete. Organize team and player sets. Describe the file. Deliver to the desk, the athlete, the parent. Sell. Archive so you can find it in ten years.",
          "Existing tools already attack pieces of this — cull, edit, metadata, galleries, athlete search. That is evidence the pains are real. The opening is the seams between them.",
          "FOTO’s wedge is photography, local originals, the photographer’s last word. Sports-semantic culling + who-is-in-the-photo + same-night delivery is the stack we will not fake. Tell us, below, which wish is loudest on your card.",
        ],
        items: [
          "Turnaround — get it out immediately",
          "Sports-specific culling — the peak-action frame",
          "Athlete identification — who is in every image",
          "One workflow — stop transferring files",
          "Edit like me — per frame, one gallery",
          "Automatic collections — team and player sets",
          "Sell — consumer sports money while you shoot",
          "Never lose a file — ingest and backup",
          "Captions — IPTC without the typing",
          "Archive search — the whole career, like Google",
        ],
      },
    ],
  },
  {
    slug: "sports-photo-editing-tips",
    title: "Sports photo editing after the game: nine habits that hold up",
    description:
      "A sports workflow for a full card: pick the burst, hold the motion, fix the lights, and send a set that still looks like one photographer.",
    category: "Guides",
    published: "2026-09-10",
    cover: "/images/blog/sports-editing.jpg",
    minutes: 12,
    sections: [
      {
        title: "The card is the job",
        paragraphs: [
          "Three hours of play, a card full of bursts, and someone who wants the set before they leave the lot. Sports editing is not a mood board. It is volume, mixed light, and a clock.",
          "Most nights fail in the same place: you start polishing before the set exists. You second-guess every near-duplicate. Stadium lights fight the white balance. Sharpening turns jerseys into plastic. The gallery goes out late, or it goes out looking like three different photographers shot it.",
          "What follows is nine habits. They are the same problems every sports shooter already knows. The FOTO version is honest about the product: suggestions on the pile, your pick, originals untouched, a gallery you can send tonight. Finish work still belongs in the editor you already trust.",
        ],
      },
      {
        title: "1. Cull the burst. Keep the story.",
        paragraphs: [
          "Burst mode is how you catch the catch. It is also how you end up with sixty frames of the same reach. The 5% that matter are usually obvious once you stop treating every frame as a candidate: ball contact, the top of a jump, the face that changes, the step where the play turns.",
          "Walk a sequence in order. The reach, the catch, the defender’s face, the start of the celebration — those are four photographs, not forty. Near-duplicates do not all deserve a develop pass.",
          "FOTO Smart Cull can flag blur, blinks, and burst duds. It does not auto-delete. Rejects are flags. Originals stay on the card and on disk. You still mark the keepers. That is the point: shrink the pile without giving the night away to a model.",
        ],
      },
      {
        title: "2. Straighten first. Crop for the play.",
        paragraphs: [
          "A tilted horizon reads as haste, not style. Level the frame before you invent a crop. Then decide whether the story is the face, the full body, or the field around them.",
          "Leave room in the direction of travel so the athlete moves into the frame. Do not crop through joints unless you mean it. Hands and feet usually belong in the picture. Background stays when it is part of the play — a packed stand, an empty end zone, a scoreboard that actually matters.",
          "Close crops on a grip or a ball, a tall crop for a jumper, a wide crop for the whole collision: those are choices, not defaults. If the client needs a story crop and a square, decide that on the pick, not on the second export.",
        ],
      },
      {
        title: "3. Keep the freeze. Keep the blur.",
        paragraphs: [
          "Sports need a sharp subject and, often, a streak of motion. Global crunch kills both. Over-sharpening makes the athlete look cut out. Under-editing leaves the whole frame mush.",
          "Sharpen the person. Let the background stay a little softer so the play has depth. If the panning blur is the photograph, do not “fix” it. Motion is information.",
          "Do the local work in the editor you finish in. FOTO is not a replacement for Lightroom or Photoshop masks. It is the pass that decides which frames are worth that work.",
        ],
      },
      {
        title: "4. Treat the lights as one problem, not a thousand.",
        paragraphs: [
          "Noon sun, cheap gym LEDs, mixed stadium floods, a pocket of shade on the sideline — sports white balance is chaos. Correct it before you grade. A gallery that shifts color every ten frames looks unauthored.",
          "Set a custom white balance in camera when you can. Batch the sequences that share a lighting setup: under the roof, on the far sideline, after the lights came on. Do not correct every frame as if it were a different night.",
          "If a look you already use holds across a gym, save it and apply it as a starting point. Confirm the color on a real file from that venue before you trust it on the whole card.",
        ],
      },
      {
        title: "5. Sharpen the athlete, not the noise.",
        paragraphs: [
          "Uniforms are texture. Faces need the detail. High ISO already brought the grain. Global sharpening just makes the grain louder.",
          "Put the bite on the subject — jersey, ball, expression — and leave the stands alone. Texture on fabric is usually enough. A high-pass or a tight mask in Photoshop is still the controlled way if you need more.",
          "The mistake is plastic skin and crunchy backgrounds. If it looks like a video-game render, you went too far.",
        ],
      },
      {
        title: "6. Grade for the night you were actually at.",
        paragraphs: [
          "RAW sports files often come back cold: LED gyms, green bounce off the turf, skin that looks gray. Color is how you say whether this was a late-afternoon field or a hard indoor court. Warmth can add intensity. It can also lie.",
          "Lift vibrance carefully. Watch the reds in the jerseys. Match the brief: a recap gallery is not a campaign, and a campaign is not yours to reinvent if the client already has a palette.",
          "Fifty frames or five hundred, they should feel like one photographer. Start from one look, then correct the exceptions. FOTO can remember a look you save for your own work. It is not used to train a shared model for other photographers.",
        ],
      },
      {
        title: "7. One pass for the pile. One pass for the pictures.",
        paragraphs: [
          "Do not try to cull, grade, crop, and retouch in a single scroll. Sports volume punishes that. A first pass throws out the disasters. A second pass is the keepers. A third pass is the client set and the export.",
          "Suggestions help on the first pass — focus, blinks, near-duplicates. They do not choose the story. If two frames are both sharp, you still decide which face is the photograph.",
          "When the set exists, take it to the editor you already finish in. Matching sliders is not matching pixels. Check a file from this venue before you batch the rest.",
        ],
      },
      {
        title: "8. Quiet the background. Don’t invent a new stadium.",
        paragraphs: [
          "Banners, foam fingers, officials, a photographer in the end zone — venues are clutter. The background should support the athlete, not compete.",
          "A little blur, a darker stand, less saturation behind the subject: those are usually enough. Remove the thing that actually ruins the frame. Do not rebuild the stadium.",
          "If you take a distraction out, look at the edges. A clean miss is better than a melted patch of turf. Originals stay untouched either way, so you can put it back.",
        ],
      },
      {
        title: "9. Organize like you have to find this game in six months.",
        paragraphs: [
          "Folders by game, team, or half. Names you will understand in March. Ratings on the pick, not after you have already developed three hundred files. Separate the lighting setups so a batch does not “fix” the night game with the afternoon white balance.",
          "Export from a set you already chose. Story crop, square, full-res — decide once. The gallery is a copy you publish. The masters stay with you.",
          "Same-night delivery is an order of work, not a slogan: import, pick, prepare, send. If the night runs long, publish what you have and follow up. Do not wait on a feature that is not in the path.",
        ],
      },
      {
        title: "What you can control",
        paragraphs: [
          "You cannot make the quarterback throw a spiral or make the gym lights behave. You can decide which frames are the night, hold the motion that belongs, and send a set that still looks like you.",
          "FOTO is built for that order: import a shoot, pick the keepers, send a gallery. Originals stay local. Smart Cull suggests. You keep the last word. Adobe stays available when you want it.",
        ],
      },
      {
        title: "Questions that come up on a sports card",
        paragraphs: [
          "Do sports photographers edit? Yes. The lights are rarely kind, the volume is real, and a client set has to hold together. Editing here is correction and selection, not inventing a play that did not happen.",
          "JPEG or RAW? RAW when you can. Mixed light and high contrast are the whole job. The extra size is cheaper than a file you cannot recover.",
          "Camera starting points, not rules: shoot RAW, shutter fast enough for the sport (often 1/500s or quicker unless you are panning on purpose), ISO as low as the lights allow, aperture wide enough to separate the subject without losing the catch.",
          "What usually ruins the set? Over-sharpening, and a white balance that changes every burst. Preserve the motion you meant. Make the color one photographer’s.",
        ],
      },
    ],
  },
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
    id: "0363502",
    date: "2026-09-16",
    title: "A teacher in Develop",
    description: "Ask for a look. A buddy points at the real sliders and says why.",
    changes: [
      "Type a look on the canvas — warmer, cinematic, sonder — or hold Talk.",
      "A blue triangle flies to Temp, Tint, Highlights, and the rest. One beat, then it waits.",
      "Color theory is drawn on the photograph: person, windows, street, skin.",
      "Show points. Do moves the slider. Undo is one history row.",
    ],
    note: "Hosted Develop uses the browser renderer for basic tone. Color wheels and HSL still need the local C++ engine.",
  },
  {
    id: "2a37ad8",
    date: "2026-09-15",
    title: "Calendar that opens Maps",
    description: "Bookings sit in week, day, month, and year. Locations go to Google Maps.",
    changes: [
      "Week, day, month, quarter, and year share one calendar.",
      "Event locations save as Google Maps search links.",
      "Drag to create. All-day events open. The now-line crosses today.",
    ],
    note: "Places search uses Nominatim. A Google Maps API key is not required for search URLs.",
  },
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
      { title: `${title} — ${PRODUCT_NAME}` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} — ${PRODUCT_NAME}` },
      { property: "og:description", content: description },
    ],
    links: [{ rel: "canonical", href: `https://lenslab.dev${path}` }],
  };
}
