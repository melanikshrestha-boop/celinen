/** LLM is the director. These names are the crew call sheet. */

export const LENSLAB_TOOL_NAMES = [
  "get_selected_images",
  "inspect_image",
  "read_exif",
  "compare_images",
  "find_similar_images",
  "get_edit_history",
  "apply_white_balance",
  "apply_crop",
  "apply_mask",
  "remove_object",
  "retouch_skin",
  "adjust_exposure",
  "apply_color_grade",
  "export_images",
  "create_instagram_post",
  "publish_gallery",
] as const;

export type LenslabToolName = (typeof LENSLAB_TOOL_NAMES)[number];

export const LENSLAB_TOOL_CATALOG = LENSLAB_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  function: {
    name,
    description: `Director call for ${name.replaceAll("_", " ")}. The imaging engine performs it. Conversation mode may only propose.`,
    parameters: { type: "object", properties: {} },
  },
}));

export function formatToolsForPrompt(): string {
  return `Callable crew (conversation proposes, Studio executes): ${LENSLAB_TOOL_NAMES.join(", ")}.`;
}
