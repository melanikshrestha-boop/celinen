/**
 * The Studio command vocabulary.
 *
 * Parsing lives here instead of in the chat UI so every command surface can
 * share the same deterministic, offline-first behaviour. A hosted planner may
 * emit these calls too, but it is never required for the commands below.
 */

export type ToolName =
  | "auto_refine"
  | "cull"
  | "keep_top"
  | "reject_flagged"
  | "set_filter"
  | "select_photo"
  | "apply_edits"
  | "export_keepers"
  | "write_xmp"
  | "import_photos"
  | "undo_last"
  | "send_gallery";

export type ToolCall = { name: ToolName; args: Record<string, unknown> };

export type LocalCommandMatch = {
  calls: ToolCall[];
  /** A command-match summary, not an execution receipt; tool results confirm outcomes. */
  reply: string;
};

export const STUDIO_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "cull",
      description:
        "Preview conservative culling suggestions for undecided frames: suggest eligible strong frames as keeps and leave concerns undecided for review. Preserve existing decisions and propose no new rejections. Saving the proposal requires photographer approval.",
      parameters: {
        type: "object",
        properties: {
          min_score: {
            type: "number",
            description:
              "Compatibility field, not a rejection cutoff. Must be between 0 and keep_score; default 45. Low-scoring undecided frames remain available for review.",
          },
          keep_score: {
            type: "number",
            description:
              "Eligible undecided frames scoring at or above this may be suggested as keeps; review flags and manual review holds still apply. Default 70, maximum 100.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "keep_top",
      description: "Keep only the N highest-scoring frames and reject everything else.",
      parameters: {
        type: "object",
        properties: { n: { type: "number", description: "How many frames to keep." } },
        required: ["n"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_flagged",
      description: "Reject every frame carrying any of the given flags.",
      parameters: {
        type: "object",
        properties: {
          flags: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "soft",
                "blur",
                "underexposed",
                "overexposed",
                "duplicate",
                "face-soft",
                "eyes-closed",
              ],
            },
          },
        },
        required: ["flags"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_filter",
      description: "Change which frames the filmstrip shows.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["all", "todo", "keepers", "flagged", "rejected"] },
        },
        required: ["filter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_photo",
      description:
        "Open a frame on the light table. Use 'best', 'worst', a filename, or a 1-based position.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_edits",
      description:
        "Apply develop settings. Values are -100..100 except crop. Target 'selected' or 'keepers'.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["selected", "keepers"] },
          exposure: { type: "number" },
          contrast: { type: "number" },
          temperature: { type: "number" },
          saturation: { type: "number" },
          highlights: { type: "number" },
          shadows: { type: "number" },
          crop: { type: "string", enum: ["orig", "1:1", "4:5", "3:2", "16:9"] },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_refine",
      description:
        "Auto refine: set exposure, contrast, white balance, highlights, shadows and saturation from each frame's histogram.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["selected", "keepers", "all"] },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_keepers",
      description: "Export every keeper as an edited JPEG.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "write_xmp",
      description: "Write XMP sidecars so Lightroom picks up ratings and develop settings.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "import_photos",
      description: "Open the file picker so the photographer can load a shoot.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_last",
      description: "Undo the most recent reversible Studio action.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_gallery",
      description:
        "Open the exact keeper set in Develop to review export proofs. Does not publish or send a gallery.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

const TOOL_NAMES = new Set<ToolName>(STUDIO_TOOL_DEFINITIONS.map((tool) => tool.function.name));

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && TOOL_NAMES.has(value as ToolName);
}

const FILTER_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:to[ -]?do|to review|unreviewed|undecided)\b/, "todo"],
  [/\b(?:keepers?|picks?|selects?)\b/, "keepers"],
  [/\b(?:flagged|problems?)\b/, "flagged"],
  [/\b(?:rejects?|rejected|cuts?)\b/, "rejected"],
  [/\b(?:all|everything)\b/, "all"],
];

const FLAG_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:blur|blurred|blurry|out[ -]of[ -]focus)\b/, "blur"],
  [/\b(?:duplicates?|dupes?)\b/, "duplicate"],
  [/\b(?:eyes?[ -]closed|closed[ -]eyes?|blinks?)\b/, "eyes-closed"],
  [/\b(?:face[ -]soft|soft[ -]faces?)\b/, "face-soft"],
  [/\b(?:underexposed|too[ -]dark)\b/, "underexposed"],
  [/\b(?:overexposed|blown(?:[ -]out)?|blown[ -]highlights?)\b/, "overexposed"],
  [/\bsoft(?:[ -]focus)?\b/, "soft"],
];

function numberFrom(text: string, pattern: RegExp): number | undefined {
  const raw = pattern.exec(text)?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function editTarget(text: string): "selected" | "keepers" {
  return /\b(?:keepers?|picks?|selects?)\b/.test(text) ? "keepers" : "selected";
}

function refineTarget(text: string): "selected" | "keepers" | "all" {
  if (/\b(?:all|everything|whole shoot|entire shoot)\b/.test(text)) return "all";
  return editTarget(text);
}

function filterFrom(text: string): string | undefined {
  for (const [pattern, filter] of FILTER_ALIASES) {
    if (pattern.test(text)) return filter;
  }
  return undefined;
}

function flagsFrom(text: string): string[] {
  const flags: string[] = [];
  for (const [pattern, flag] of FLAG_ALIASES) {
    if (pattern.test(text) && !flags.includes(flag)) flags.push(flag);
  }
  return flags;
}

function selectionQuery(source: string, normalized: string): string | undefined {
  const special = /\b(best|worst)\b/.exec(normalized)?.[1];
  if (special) return special;

  if (/^\d+$/.test(normalized)) return normalized;

  const position = /(?:\b(?:photo|frame|image|shot)\s*#?\s*|#)(\d+)\b/.exec(normalized)?.[1];
  if (position) return position;

  const quoted = /["']([^"']+)["']/.exec(source)?.[1]?.trim();
  if (quoted) return quoted;

  const remainder = source
    .replace(/^\s*(?:please\s+)?(?:open|select|focus on|go to|show)\s+/i, "")
    .replace(/^(?:photo|image|frame|shot)\s+/i, "")
    .trim();
  const filename =
    /^(.+\.(?:jpe?g|png|webp|heic|tiff?|nef|cr2|cr3|arw|dng|raf|orf|rw2|pef|srw|raw))$/i
      .exec(remainder)?.[1]
      ?.trim();
  return filename || undefined;
}

function addNumericEdit(
  text: string,
  patch: Record<string, unknown>,
  key: "exposure" | "contrast" | "temperature" | "saturation" | "highlights" | "shadows",
  aliases: string,
) {
  const value = numberFrom(
    text,
    new RegExp(`\\b(?:${aliases})\\s*(?:to|at|=|by)?\\s*([+-]?\\d+(?:\\.\\d+)?)\\b`),
  );
  if (value !== undefined) patch[key] = value;
}

/**
 * Parse high-value Studio phrases without a network or model. Returns null
 * when the phrase is genuinely open-ended so an optional hosted planner may
 * take over.
 */
export function parseLocalCommand(input: string): LocalCommandMatch | null {
  const source = input.trim();
  if (!source) return null;
  const text = source.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const calls: ToolCall[] = [];

  if (/^(?:undo|undo that|undo last|go back|revert(?: that| last)?)\.?$/.test(text)) {
    return {
      calls: [{ name: "undo_last", args: {} }],
      reply: "Matched 1 local command. Tool results report execution and any approval needed.",
    };
  }

  const wantsImport =
    /^(?:import|load|add)(?:\s+(?:a|the|my))?(?:\s+(?:photos?|images?|files?|folder|shoot))?\s*$/.test(
      text,
    ) || /\b(?:import|load|add)\b.{0,24}\b(?:photos?|images?|files?|folder|shoot)\b/.test(text);
  if (wantsImport) calls.push({ name: "import_photos", args: {} });

  const wantsCull = /\b(?:auto[ -]?cull|cull)(?:ing|ed)?\b/.test(text);
  if (wantsCull) {
    const minScore = numberFrom(
      text,
      /\b(?:min(?:imum)?(?: score)?|reject(?: score)? below|score below|below)\s*(\d{1,3})\b/,
    );
    const keepScore = numberFrom(
      text,
      /\b(?:keep(?: score| at| above)|score at least)\s*(\d{1,3})\b/,
    );
    const args: Record<string, unknown> = {};
    if (minScore !== undefined) args["min_score"] = minScore;
    if (keepScore !== undefined) args["keep_score"] = keepScore;
    calls.push({ name: "cull", args });
  }

  const top = numberFrom(text, /\bkeep(?: only)?(?: the)? top\s+(\d+)\b/);
  if (top !== undefined) calls.push({ name: "keep_top", args: { n: top } });

  if (/\b(?:reject|cut|flag out)\b/.test(text)) {
    const flags = flagsFrom(text);
    if (flags.length) calls.push({ name: "reject_flagged", args: { flags } });
  }

  const wantsFilter =
    /\b(?:show|filter|view)\b/.test(text) ||
    /^(?:all|everything|to[ -]?do|to review|unreviewed|undecided|keepers?|picks?|selects?|flagged|problems?|rejects?|rejected|cuts?)$/.test(
      text,
    );
  if (wantsFilter) {
    const filter = filterFrom(text);
    const selectingSpecific = /\b(?:best|worst)\b|#\d+\b|\b(?:photo|frame|image|shot)\s+\d+\b/.test(
      text,
    );
    if (filter && !selectingSpecific) calls.push({ name: "set_filter", args: { filter } });
  }

  const wantsSelection =
    /\b(?:open|select|focus on|go to|show)\b/.test(text) ||
    /^(?:best|worst|#?\d+|(?:photo|frame|image|shot)\s*#?\s*\d+)$/.test(text);
  if (wantsSelection) {
    const query = selectionQuery(source, text);
    if (query) calls.push({ name: "select_photo", args: { query } });
  }

  if (/\b(?:auto[ -]?refine|auto[ -]?edit|auto[ -]?develop)\b/.test(text)) {
    calls.push({ name: "auto_refine", args: { target: refineTarget(text) } });
  }

  const editPatch: Record<string, unknown> = {};
  if (/\bwarm(?:er)?\b/.test(text)) {
    editPatch["temperature"] = /\b(?:very|much|a lot)\b/.test(text) ? 30 : 12;
  } else if (/\bcool(?:er)?\b/.test(text)) {
    editPatch["temperature"] = /\b(?:very|much|a lot)\b/.test(text) ? -30 : -12;
  }
  addNumericEdit(text, editPatch, "exposure", "exposure");
  addNumericEdit(text, editPatch, "contrast", "contrast");
  addNumericEdit(text, editPatch, "temperature", "temperature|temp");
  addNumericEdit(text, editPatch, "saturation", "saturation|sat");
  addNumericEdit(text, editPatch, "highlights", "highlights?");
  addNumericEdit(text, editPatch, "shadows", "shadows?");
  const crop = /\bcrop(?:\s+(?:to|at))?\s+(original|orig|1:1|4:5|3:2|16:9)\b/.exec(text)?.[1];
  if (crop) editPatch["crop"] = crop === "original" ? "orig" : crop;
  if (Object.keys(editPatch).length) {
    calls.push({
      name: "apply_edits",
      args: { target: editTarget(text), ...editPatch },
    });
  }

  const wantsXmp =
    /\b(?:xmp|sidecars?)\b/.test(text) ||
    /\b(?:send|write|sync)\b.{0,20}\b(?:to\s+)?lightroom\b/.test(text);
  if (wantsXmp) calls.push({ name: "write_xmp", args: {} });

  const wantsExport =
    /\bexport\b/.test(text) &&
    !/\b(?:xmp|sidecars?)\b/.test(text) &&
    !/\b(?:edl|fcpxml|xml|csv)\b/.test(text);
  if (wantsExport) calls.push({ name: "export_keepers", args: {} });

  const wantsSend =
    (/\b(?:send|share)\b.{0,24}\b(?:gallery|keepers?)\b/.test(text) ||
      /\bgallery tonight\b/.test(text)) &&
    !/\blightroom\b/.test(text);
  if (wantsSend) calls.push({ name: "send_gallery", args: {} });

  if (!calls.length) return null;
  return {
    calls,
    reply:
      `Matched ${calls.length} local command${calls.length === 1 ? "" : "s"}.` +
      (wantsCull
        ? " Cull preserves existing decisions and proposes no new rejections; min_score is retained for compatibility, not a rejection cutoff."
        : "") +
      " Tool results report execution and any approval needed.",
  };
}

export const LOCAL_COMMAND_HELP =
  "try “cull the shoot”, “show flagged”, “find scene changes”, “show outliers”, “open best”, “export keepers”, or “write xmp”.";
