import { DEFAULT_EDITS, type Edits } from "@/lib/imaging";

export type NumericEdit = Exclude<keyof Edits, "crop">;
export type CreativeEditTarget = "selected" | "keepers" | "all";

/** A proposed, global edit. Callers must preview/confirm before storing it. */
export interface CreativeEditPlan {
  kind: "plan";
  target: CreativeEditTarget;
  title: string;
  description: string;
  deltas: Partial<Record<NumericEdit, number>>;
  patch: Partial<Edits>;
  limitations: string[];
}

export interface CreativeEditRefusal {
  kind: "unsupported";
  reason: string;
}

export type CreativeEditResult = CreativeEditPlan | CreativeEditRefusal | null;

interface Recipe {
  id: string;
  pattern: RegExp;
  title: string;
  description: string;
  deltas?: Partial<Record<NumericEdit, number>>;
  patch?: Partial<Edits>;
  limitations?: string[];
  exclusiveTone?: boolean;
}

const GLOBAL_LIMITATION =
  "These are whole-photo adjustments, not subject-aware edits. Originals stay untouched.";
const SKY_LIMITATION =
  "This lowers highlights across the photo; it cannot reconstruct a clipped sky or isolate the sky.";
const CROP_LIMITATION =
  "This uses a centered crop, not subject tracking. Check the framing before applying.";

// Deliberately finite vocabulary: no fuzzy substring match may silently drop a
// condition, an unsupported edit, a negation, or a second action such as export.
const RECIPES: Recipe[] = [
  {
    id: "brighten",
    pattern: /^(?:brighten(?: up)?|brighter|(?:is )?too dark|increase (?:the )?brightness)$/,
    title: "Brighter",
    description: "Brighten the photo",
    deltas: { exposure: 18 },
  },
  {
    id: "darken",
    pattern: /^(?:darken(?: down)?|darker|(?:is )?too bright|reduce (?:the )?brightness)$/,
    title: "Darker",
    description: "Darken the photo",
    deltas: { exposure: -18 },
  },
  {
    id: "warm",
    pattern: /^(?:warm(?: up)?|warmer|warm(?: up)? (?:the )?(?:colors|tones))$/,
    title: "Warmer",
    description: "Give the colors a warmer feel",
    deltas: { temp: 18 },
  },
  {
    id: "cool",
    pattern: /^(?:cool(?: down)?|cooler|cool(?: down)? (?:the )?(?:colors|tones))$/,
    title: "Cooler",
    description: "Give the colors a cooler feel",
    deltas: { temp: -18 },
  },
  {
    id: "vivid",
    pattern:
      /^(?:(?:the )?colou?rs? pop|(?:the )?colou?rs? more vivid|more colou?rful|more vibrant|vibrant|vivid|punchier|boost (?:the )?colou?rs?)$/,
    title: "More color",
    description: "Add a little more color and contrast",
    deltas: { saturation: 20, contrast: 8 },
  },
  {
    id: "muted",
    pattern:
      /^(?:(?:the )?colou?rs? less intense|less colou?rful|less vibrant|muted|mute (?:the )?colou?rs?|tone down (?:the )?colou?rs?)$/,
    title: "Softer color",
    description: "Tone down the colors",
    deltas: { saturation: -20 },
  },
  {
    id: "soft",
    pattern:
      /^(?:less harsh|softer light|soften (?:the )?(?:light|contrast)|reduce (?:the )?harshness)$/,
    title: "Less harsh",
    description: "Soften contrast and bright areas while opening the shadows",
    deltas: { contrast: -15, highlights: -12, shadows: 8 },
  },
  {
    id: "contrast",
    pattern:
      /^(?:more contrast|add (?:some )?contrast|increase (?:the )?contrast|more punch|punchy)$/,
    title: "More contrast",
    description: "Give light and dark areas more separation",
    deltas: { contrast: 18 },
  },
  {
    id: "highlights",
    pattern:
      /^(?:bring back (?:the )?sky|recover (?:the )?(?:sky|highlights)|tame (?:the )?(?:bright areas|highlights)|reduce (?:the )?highlights|tone down (?:the )?bright areas)$/,
    title: "Calmer highlights",
    description: "Tone down the brightest areas",
    deltas: { highlights: -25 },
    limitations: [SKY_LIMITATION],
  },
  {
    id: "shadows",
    pattern:
      /^(?:(?:lift|open|brighten)(?: up)? (?:the )?(?:dark areas|shadows)|bring out (?:the )?(?:shadow detail|details in (?:the )?shadows))$/,
    title: "Open shadows",
    description: "Bring more light into the dark areas",
    deltas: { shadows: 25 },
  },
  {
    id: "mono",
    pattern: /^(?:monochrome|b&w|convert to monochrome|turn monochrome)$/,
    title: "Black and white",
    description: "Remove color for a black-and-white look",
    patch: { saturation: -100 },
  },
  {
    id: "cinematic",
    pattern: /^(?:cinematic|(?:a )?cinematic look|film(?:ic)? look|(?:a )?film(?:ic)? look)$/,
    title: "Cinematic study",
    description: "Try a cooler, gently muted look with deeper contrast",
    deltas: { temp: -6, saturation: -10, contrast: 15, highlights: -12, shadows: 6 },
    exclusiveTone: true,
    limitations: [
      "Cinematic is a fixed color recipe here, not an understanding of a scene or a film reference.",
    ],
  },
  {
    id: "natural",
    pattern:
      /^(?:natural|more natural|(?:a )?natural look|restore (?:the )?natural (?:colors|look)|reset (?:the )?(?:colors|color and tone|tone))$/,
    title: "Original color",
    description: "Return color and tone to the original settings while keeping the current crop",
    patch: { exposure: 0, contrast: 0, temp: 0, saturation: 0, highlights: 0, shadows: 0 },
    exclusiveTone: true,
  },
  {
    id: "square",
    pattern: /^(?:square|(?:a )?square crop|crop(?: to)? (?:a )?square|crop(?: to)? 1:1|1:1)$/,
    title: "Square crop",
    description: "Frame the photo as a centered square",
    patch: { crop: "1:1" },
    limitations: [CROP_LIMITATION],
  },
  {
    id: "portrait",
    pattern: /^(?:portrait crop|(?:a )?portrait crop|crop(?: to)? portrait|crop(?: to)? 4:5|4:5)$/,
    title: "Portrait crop",
    description: "Frame the photo in a centered 4:5 portrait crop",
    patch: { crop: "4:5" },
    limitations: [CROP_LIMITATION],
  },
  {
    id: "wide",
    pattern:
      /^(?:widescreen|(?:a )?widescreen crop|crop(?: to)? widescreen|crop(?: to)? 16:9|16:9)$/,
    title: "Widescreen crop",
    description: "Frame the photo in a centered 16:9 crop",
    patch: { crop: "16:9" },
    limitations: [CROP_LIMITATION],
  },
  {
    id: "uncrop",
    pattern:
      /^(?:uncrop|remove (?:the )?crop|restore (?:the )?original (?:crop|framing)|original framing)$/,
    title: "Original framing",
    description: "Restore the original framing",
    patch: { crop: "orig" },
  },
];

function refuse(reason: string): CreativeEditRefusal {
  return { kind: "unsupported", reason: `${reason} Nothing has been changed.` };
}

function normalise(input: string) {
  return input.toLowerCase().replace(/[’‘]/g, "'").replace(/[–—]/g, "-").trim();
}

function isPureReviewCommand(text: string) {
  const command = text
    .replace(/^(?:please |can you |could you )+/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
  if (
    /^(?:show|open|view|select) (?:the )?(?:best|worst|brightest|darkest|sharpest|softest)(?: (?:photo|image|shot|frame))?$/.test(
      command,
    ) ||
    /^auto[ -]?(?:refine|edit|develop)(?: (?:the |my )?(?:selected|keepers|picks|all|everything|whole shoot))?$/.test(
      command,
    )
  )
    return true;
  if (!/^(?:reject|cut|flag out) /.test(command)) return false;
  const rest = command.replace(/^(?:reject|cut|flag out) /, "");
  const reviewWords = new Set([
    "everything",
    "all",
    "every",
    "any",
    "the",
    "photos",
    "images",
    "shots",
    "frames",
    "that",
    "are",
    "with",
    "or",
    "and",
    "blur",
    "blurred",
    "blurry",
    "soft",
    "focus",
    "out",
    "of",
    "underexposed",
    "overexposed",
    "duplicate",
    "duplicates",
    "dupes",
    "eyes",
    "closed",
    "blinks",
    "faces",
    "face",
    "too",
    "dark",
    "blown",
    "highlights",
  ]);
  return rest.length > 0 && rest.split(/[ -]+/).every((word) => reviewWords.has(word));
}

/**
 * Deterministic plain-English planning, not an open-ended AI quality score.
 * Unknown non-edit input returns null so navigation/culling can handle it.
 * Recognizable but unsafe/unsupported edit requests return an explicit refusal.
 */
export function parseCreativeEdit(input: string): CreativeEditResult {
  if (input.length > 1000) return refuse("Please describe one short edit at a time.");
  let text = normalise(input);
  if (!text) return null;
  if (isPureReviewCommand(text)) return null;
  const looksLikeEdit =
    /\b(?:bright\w*|dark\w*|warm\w*|cool\w*|colou?r\w*|harsh\w*|soften|contrast|highlight\w*|shadow\w*|sky|monochrome|black|white|cinematic|filmic|natural|crop\w*|uncrop|framing|widescreen|square|portrait|vibrant|vivid|punch\w*|muted|edit\w*|retouch|background|skin|remove|replace|exposure|saturation|temperature|transform|heal|mask|blur|sharpen|match|reference)\b|\bb&w\b|\b(?:1:1|4:5|16:9)\b/.test(
      text,
    );
  if (!looksLikeEdit) return null;

  // “Only my keepers” narrows the batch; “only the skin” needs a mask and
  // remains unsupported. Do not remove a general “only” constraint.
  text = text.replace(/\bonly\s+((?:(?:my|the)\s+)?(?:keepers|picks|selects))\b/g, "$1");
  const preserveNatural =
    /\s+(?:but|and)\s+keep\s+(?:it|them|this|these|the photos)\s+(?:looking\s+)?natural[.!?]*$/.test(
      text,
    );
  text = text.replace(
    /\s+(?:but|and)\s+keep\s+(?:it|them|this|these|the photos)\s+(?:looking\s+)?natural[.!?]*$/,
    "",
  );

  if (
    /\b(?:not|no|never|without|except|unless|avoid|don't|dont|can't|cannot|won't|shouldn't|unchanged|untouched|preserve|protect|only)\b/.test(
      text,
    )
  ) {
    return refuse(
      "I can't reliably honor selective constraints or negation yet. Try a whole-photo edit such as “make it warmer,” then check the preview.",
    );
  }
  if (
    /\b(?:skin|face|faces|person|people|player|players|subject|background|jersey|logo|object|mask|heal|retouch|generative|sharpen|deblur|remove blur|motion blur|film grain|match|reference)\b/.test(
      text,
    )
  ) {
    return refuse(
      "That needs subject-aware or reference-aware editing, which this local editor does not support yet.",
    );
  }

  // Protect this look before splitting compound requests on “and”.
  text = text.replace(/\bblack(?:\s+and\s+|-and-|\s*&\s*)white\b/g, "monochrome");
  text = text
    .replace(
      /^(?:(?:please|can you|could you|would you|i want to|i would like to|i'd like to)\s+)+/,
      "",
    )
    .replace(/\s+please[.!?]*$/, "");

  const targets = new Set<CreativeEditTarget>();
  const takeTarget = (pattern: RegExp, target: CreativeEditTarget) => {
    text = text.replace(pattern, () => {
      targets.add(target);
      return " ";
    });
  };
  takeTarget(
    /\b(?:(?:on|for|to|across)\s+)?(?:(?:all|just)\s+)?(?:(?:my|the)\s+)?(?:keepers?|picks|selects)\b/g,
    "keepers",
  );
  takeTarget(
    /\b(?:(?:on|for|to|across)\s+)?(?:the\s+)?(?:whole|entire)\s+(?:shoot|batch)\b/g,
    "all",
  );
  takeTarget(
    /\b(?:(?:on|for|to|across)\s+)?(?:all(?:\s+(?:of\s+)?(?:the\s+|my\s+)?(?:photos|images|shots|frames))?|everything)\b/g,
    "all",
  );
  takeTarget(
    /\b(?:(?:on|for|to)\s+)?(?:(?:this|the selected|the current|selected|current|the)\s+(?:photo|image|shot|frame)|these(?:\s+(?:photos|images|shots|frames))?|this|it|them)\b/g,
    "selected",
  );
  if (targets.size > 1)
    return refuse(
      "That names more than one scope. Choose this photo, keepers, or the whole shoot.",
    );
  const target: CreativeEditTarget = targets.values().next().value ?? "selected";

  const subtle =
    preserveNatural ||
    /\b(?:subtly|subtle|slightly|gently|a little(?: bit)?|a bit|just a touch)\b/.test(text);
  const strong = /\b(?:strongly|strong|dramatically|a lot|much|very)\b/.test(text);
  if (subtle && strong)
    return refuse("Choose either a subtle or a strong adjustment for this preview.");
  text = text.replace(
    /\b(?:subtly|subtle|slightly|gently|a little(?: bit)?|a bit|just a touch|strongly|strong|dramatically|a lot|much|very)\b/g,
    " ",
  );
  const scale = subtle ? 0.5 : strong ? 1.5 : 1;

  const clauses = text
    .replace(/[.!?]+$/, "")
    .split(/\s*[,;]\s*|\s+and(?:\s+then)?\s+|\s+then\s+/)
    .map((clause) =>
      clause
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^(?:make |give )?(?:feel |look )?/, "")
        .trim(),
    );
  if (!clauses.length || clauses.some((clause) => !clause))
    return refuse("Please describe a complete edit, such as “brighten this and make it warmer.”");

  const recipes: Recipe[] = [];
  for (const clause of clauses) {
    const recipe = RECIPES.find((candidate) => candidate.pattern.test(clause));
    if (!recipe)
      return refuse(
        `I can't safely translate the whole request yet (“${clause}”). Try brightness, warmth, color, shadows, highlights, or a crop.`,
      );
    if (!recipes.some((existing) => existing.id === recipe.id)) recipes.push(recipe);
  }
  const tonalRecipes = recipes.filter((recipe) => !recipe.patch?.crop);
  if (tonalRecipes.length > 1 && tonalRecipes.some((recipe) => recipe.exclusiveTone)) {
    return refuse(
      "Preview the cinematic or natural look on its own first, then fine-tune it with another request.",
    );
  }

  const patch: Partial<Edits> = {};
  const deltas: Partial<Record<NumericEdit, number>> = {};
  for (const recipe of recipes) {
    for (const [key, value] of Object.entries(recipe.deltas ?? {}) as Array<
      [NumericEdit, number]
    >) {
      const existing = deltas[key];
      if (
        patch[key] !== undefined ||
        (existing !== undefined && Math.sign(existing) !== Math.sign(value))
      ) {
        return refuse(
          "Those adjustments pull the same setting in opposite directions. Preview one direction first.",
        );
      }
      deltas[key] = (existing ?? 0) + Math.round(value * scale);
    }
    for (const [key, value] of Object.entries(recipe.patch ?? {}) as Array<
      [keyof Edits, Edits[keyof Edits]]
    >) {
      if (
        (key !== "crop" && deltas[key] !== undefined) ||
        (patch[key] !== undefined && patch[key] !== value)
      ) {
        return refuse("Those edits conflict. Choose one look or crop for this preview.");
      }
      Object.assign(patch, { [key]: value });
    }
  }
  const limitations = [
    ...new Set([GLOBAL_LIMITATION, ...recipes.flatMap((recipe) => recipe.limitations ?? [])]),
  ];
  if (preserveNatural)
    limitations.push(
      "“Keep it natural” uses a gentler adjustment, not skin-tone protection or a judgement of the scene. Check the preview.",
    );
  if ((subtle || strong) && !Object.keys(deltas).length) {
    return refuse(
      "Intensity does not apply to this crop, black-and-white conversion, or reset. Ask for it without subtle or strong.",
    );
  }
  return {
    kind: "plan",
    target,
    title: `${subtle ? "Subtle · " : strong ? "Strong · " : ""}${recipes.map((recipe) => recipe.title).join(" + ")}`,
    description: `${recipes.map((recipe) => recipe.description).join("; ")}.`,
    patch,
    deltas,
    limitations,
  };
}

/** Relative edits are evaluated against each frame, preserving batch variations. */
export function applyCreativeEdit(current: Edits, plan: CreativeEditPlan): Edits {
  const next: Edits = { ...current, ...plan.patch };
  for (const key of [
    "exposure",
    "contrast",
    "temp",
    "saturation",
    "highlights",
    "shadows",
  ] as const) {
    const base = Number.isFinite(next[key]) ? next[key] : DEFAULT_EDITS[key];
    const delta = plan.deltas[key] ?? 0;
    next[key] = Math.max(-100, Math.min(100, base + (Number.isFinite(delta) ? delta : 0)));
  }
  return next;
}
