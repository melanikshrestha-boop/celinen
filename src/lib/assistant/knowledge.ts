/** Photography knowledge, retrieved — not vibes. */

export type KnowledgeDoc = { id: string; title: string; tags: string[]; body: string };

export const PHOTOGRAPHY_KNOWLEDGE: KnowledgeDoc[] = [
  {
    id: "hss",
    title: "High-speed sync",
    tags: ["hss", "flash", "shutter", "sync", "sports"],
    body: "HSS (high-speed sync) lets a speedlight or strobe work above the camera's native flash-sync speed, typically 1/200–1/250 s. The flash pulses across the shutter travel so you can use 1/1000 s and still light a subject in daylight. Power drops versus a full pop. For sideline fill in sun, HSS plus a strong pack beats raising ISO alone.",
  },
  {
    id: "helmet-af",
    title: "Autofocus through a football helmet",
    tags: ["af", "helmet", "canon", "r5", "sports", "focus", "subject detection"],
    body: "Helmet facemasks break face/eye detection: the camera sees bars, not a face. On Canon R5 / R5 Mark II, animal/people detection often hops to the crown or a nearby player. For through-mask work: AF area small or spot on the eyes behind the bars, subject detection off or people+spot, back-button AF, 1/1000 s or faster, and a 70–200 that can hold a single subject. If the whole burst is directionally smeared, that is shutter too slow, not AF.",
  },
  {
    id: "sports-shutter",
    title: "Sports shutter speeds",
    tags: ["shutter", "soft", "blur", "basketball", "football", "motion"],
    body: "Peak-action sports: 1/1000–1/2000 s for running and ball sports; 1/320 s will smear a face even if AF locked. Indoor basketball often needs 1/800–1/1250 and ISO up. Intentional pan blur is a different choice: 1/60–1/125 with the subject tracked. Directional smear on the face = motion blur. Uniform softness = missed AF or too-slow lens.",
  },
  {
    id: "seventy-two-hundred",
    title: "70–200mm f/2.8 for basketball and football",
    tags: ["lens", "70-200", "basketball", "football", "favorite", "courtside"],
    body: "If Lenslab has to choose one sports lens, 70–200mm f/2.8. Courtside and sideline it covers most of the useful range without constant repositioning, f/2.8 helps indoors, and compression isolates players. A 24–70 is the add-on, not the replacement. A 135mm prime wins only if the photographer already lives in tight isolation.",
  },
  {
    id: "inverse-square",
    title: "Inverse-square law",
    tags: ["light", "flash", "inverse", "square", "falloff"],
    body: "Illumination falls with the square of distance. Double the flash-to-subject distance and you lose two stops. That is why a sideline strobe that looks fine at 12 ft is useless at 24 ft without more power or a tighter beam.",
  },
  {
    id: "skin-texture",
    title: "Skin texture in edits",
    tags: ["skin", "retouch", "clarity", "smoothing", "portrait"],
    body: "Preserve pores. Drop clarity/texture on skin locally rather than global smoothing. Heavy HDR, extra saturation, and frequency-separation plastic are a reject. Lenslab's house taste: natural_skin 0.96, never over-smooth.",
  },
  {
    id: "peak-action",
    title: "Peak action vs clean portrait",
    tags: ["peak", "action", "cull", "sports", "deliver"],
    body: "A technically cleaner frame that lost the defender, the ball, or the face is a sports portrait, not the moment. Deliver the frame where peak action, face, and story coexist. Eyes slightly softer is acceptable if the collision is true.",
  },
  {
    id: "licensing",
    title: "Usage rights in short",
    tags: ["licensing", "rights", "business", "contract"],
    body: "Personal use is not commercial use. A school, a brand, or a wire needs a written license: who, where, how long, exclusive or not. Do not tell a photographer they can 'just post it' for a client without a grant of rights.",
  },
  {
    id: "wedding-light",
    title: "Wedding ceremony and reception light",
    tags: ["wedding", "ceremony", "reception", "flash", "aisle", "bounce"],
    body: "Ceremony: no-flash rules are common; 50/85 at f/1.8–f/2.2, 1/250 or faster for walking, ISO as needed, expose for faces not windows. Recessional: same lens, slightly more shutter. Reception: bounce off a ceiling or wall, gel to the room (CTO on tungsten), don't nuke the dance floor with direct on-camera. First dance: one bounced key plus ambient so it still looks like the room.",
  },
  {
    id: "portrait-light",
    title: "Portrait lighting patterns",
    tags: ["portrait", "rembrandt", "loop", "butterfly", "split", "beauty"],
    body: "Loop: small shadow off the nose, workhorse for most faces. Rembrandt: triangle on the far cheek, more drama. Butterfly/Paramount: light high on axis, glamour and beauty. Split: half the face in light, editorial or music. Catchlights in both eyes unless you are hiding one on purpose. Distance and size of the source beat modifier brand names.",
  },
  {
    id: "kelvin",
    title: "White balance in kelvin",
    tags: ["kelvin", "wb", "white", "balance", "tungsten", "daylight", "color"],
    body: "Daylight ~5200–5600 K, open shade ~7000–8000 K (cool), tungsten ~2800–3200 K (warm unless you correct). Mixed practicals: pick the key and let the rest go, or gel the flash. Skin too orange is often WB too warm or a gel mismatch, not 'just add teal'. Lock a custom WB from a gray card when the room will not change.",
  },
  {
    id: "bounce-flash",
    title: "Bounce flash",
    tags: ["bounce", "flash", "ceiling", "gel", "event"],
    body: "Point the head at a ceiling or wall, not the face. White or light surfaces only; green walls tint skin. Dial flash exposure compensation after you see the histogram, not from the LCD glow. A card or MagMod sphere is fill, not the key. If the ceiling is high and black, bounce is dead — switch to a modifier or raise ISO.",
  },
];

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((part) => part.length > 2);
}

export function retrievePhotographyKnowledge(query: string, limit = 3): KnowledgeDoc[] {
  const asked = new Set(tokens(query));
  if (!asked.size) return [];
  return PHOTOGRAPHY_KNOWLEDGE.map((doc) => {
    const hay = new Set([...tokens(doc.title), ...doc.tags, ...tokens(doc.body)]);
    let hit = 0;
    for (const token of asked) if (hay.has(token)) hit += 1;
    for (const tag of doc.tags) if (asked.has(tag)) hit += 2;
    return { doc, hit };
  })
    .filter((row) => row.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, limit)
    .map((row) => row.doc);
}

export function formatKnowledgeForPrompt(docs: readonly KnowledgeDoc[]): string {
  if (!docs.length) return "";
  return docs.map((doc) => `[${doc.id}] ${doc.title}: ${doc.body}`).join("\n");
}
