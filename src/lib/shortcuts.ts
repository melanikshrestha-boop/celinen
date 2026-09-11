import { z } from "zod";

export const GLOBAL_KEYS = [
  "Mod+,",
  "Mod+k",
  "Ctrl+Space",
  "Alt+Shift+p",
  "Alt+Shift+n",
  "Alt+Shift+s",
  "Alt+Shift+k",
  "Alt+Shift+j",
  "Alt+Shift+c",
  "Alt+Shift+t",
  "Mod+Alt+n",
  "Mod+Shift+a",
  "Mod+Alt+o",
  "Mod+Alt+s",
  "Mod+Shift+u",
  "Mod+Alt+p",
  "Mod+Alt+r",
  "",
] as const;
export const MEDIA_KEYS = ["k", "x", "u", "a", "r", "j", "l", "h", ""] as const;
export const SHORTCUTS = [
  { id: "settings", label: "Open settings", category: "Workspace", default: "Mod+," },
  { id: "tools", label: "Open command palette", category: "Workspace", default: "Mod+k" },
  { id: "projects", label: "Switch projects", category: "Workspace", default: "Alt+Shift+p" },
  { id: "newShoot", label: "New project", category: "Workspace", default: "Alt+Shift+n" },
  { id: "pet", label: "Show or hide pet", category: "Workspace", default: "Ctrl+Space" },
  {
    id: "newChat",
    label: "New shoot",
    category: "Shoots · in the current project",
    default: "Alt+Shift+c",
  },
  {
    id: "temporaryChat",
    label: "New temporary chat",
    category: "Chat · not saved in history",
    default: "Alt+Shift+t",
  },
  {
    id: "quickChat",
    label: "Quick chat",
    category: "Chat · compact floating composer",
    default: "Mod+Alt+n",
  },
  {
    id: "archiveChat",
    label: "Archive shoot",
    category: "Shoots · current conversation",
    default: "Mod+Shift+a",
  },
  {
    id: "standaloneChat",
    label: "New standalone shoot",
    category: "Shoots · starts a separate project",
    default: "Mod+Alt+o",
  },
  {
    id: "sideChat",
    label: "Open side chat",
    category: "Chat · beside Studio",
    default: "Mod+Alt+s",
  },
  { id: "unreadChat", label: "Mark as unread", category: "Chat", default: "Mod+Shift+u" },
  {
    id: "newWindow",
    label: "Open in new window",
    category: "Chat · same saved conversation",
    default: "",
  },
  { id: "togglePin", label: "Toggle pin", category: "Chat", default: "Mod+Alt+p" },
  { id: "renameChat", label: "Rename shoot", category: "Shoots", default: "Mod+Alt+r" },
  { id: "focusMain", label: "Focus main chat", category: "Chat · focus the composer", default: "" },
  {
    id: "focusSide",
    label: "Focus side chat",
    category: "Chat · focus beside Studio",
    default: "",
  },
  {
    id: "goToPhoto",
    label: "Go to photo",
    category: "Studio · photo number (Go to line equivalent)",
    default: "",
  },
  { id: "keep", label: "Keep selected photo", category: "Studio", default: "k" },
  { id: "reject", label: "Soft reject selected photo", category: "Studio", default: "x" },
  { id: "undecided", label: "Mark selected photo undecided", category: "Studio", default: "u" },
  { id: "refine", label: "Auto-refine selected photo", category: "Studio", default: "a" },
  { id: "reset", label: "Reset selected photo edits", category: "Studio", default: "r" },
] as const;
export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
const reserved = new Set([
  "Mod+n",
  "Mod+t",
  "Mod+w",
  "Mod+l",
  "Mod+r",
  "Mod+q",
  "Mod+p",
  "Mod+s",
  "Mod+o",
  "Mod+f",
  "Mod+h",
  "Mod+Shift+n",
  "Mod+Shift+t",
  "Mod+Shift+w",
  "Mod+Shift+o",
  "Mod+Shift+b",
  "Alt+ArrowLeft",
  "Alt+ArrowRight",
]);
export const globalShortcut = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      value === "Ctrl+Space" ||
      (/^(?:Mod\+(?:Alt\+)?(?:Shift\+)?|Alt\+Shift\+)[a-z0-9,./;]$/.test(value) &&
        !reserved.has(value)),
    "Use a modified key not reserved by the browser (for example Alt + Shift + J).",
  );
export const shortcutsSchema = z
  .object({
    settings: globalShortcut.default("Mod+,"),
    tools: globalShortcut.default("Mod+k"),
    projects: globalShortcut.default("Alt+Shift+p"),
    newShoot: globalShortcut.default("Alt+Shift+n"),
    pet: globalShortcut.default("Ctrl+Space"),
    newChat: globalShortcut.default("Alt+Shift+c"),
    temporaryChat: globalShortcut.default("Alt+Shift+t"),
    quickChat: globalShortcut.default("Mod+Alt+n"),
    archiveChat: globalShortcut.default("Mod+Shift+a"),
    standaloneChat: globalShortcut.default("Mod+Alt+o"),
    sideChat: globalShortcut.default("Mod+Alt+s"),
    unreadChat: globalShortcut.default("Mod+Shift+u"),
    newWindow: globalShortcut.default(""),
    togglePin: globalShortcut.default("Mod+Alt+p"),
    renameChat: globalShortcut.default("Mod+Alt+r"),
    focusMain: globalShortcut.default(""),
    focusSide: globalShortcut.default(""),
    goToPhoto: globalShortcut.default(""),
    keep: z.enum(MEDIA_KEYS).default("k"),
    reject: z.enum(MEDIA_KEYS).default("x"),
    undecided: z.enum(MEDIA_KEYS).default("u"),
    refine: z.enum(MEDIA_KEYS).default("a"),
    reset: z.enum(MEDIA_KEYS).default("r"),
  })
  .strict()
  .superRefine((value, context) => {
    const used = new Map<string, string>();
    for (const action of SHORTCUTS) {
      const key = value[action.id];
      if (key && used.has(key))
        context.addIssue({
          code: "custom",
          path: [action.id],
          message: `Already assigned to ${used.get(key)}.`,
        });
      if (key) used.set(key, action.label);
    }
  });
export type ShortcutBindings = z.infer<typeof shortcutsSchema>;
export const DEFAULT_SHORTCUTS = shortcutsSchema.parse({});
export function shortcutLabel(binding: string, mac = false) {
  return binding
    ? binding
        .replace("Mod", mac ? "⌘" : "Ctrl")
        .replace("Alt", mac ? "⌥" : "Alt")
        .replaceAll("+", " + ")
    : "Unassigned";
}
export function recordedShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
) {
  const key =
    event.code === "Space"
      ? "Space"
      : event.code.startsWith("Key")
        ? event.code.slice(3).toLowerCase()
        : event.code.startsWith("Digit")
          ? event.code.slice(5)
          : event.code === "Comma"
            ? ","
            : event.key.toLowerCase();
  if (event.ctrlKey && key === "Space" && !event.metaKey && !event.altKey && !event.shiftKey)
    return "Ctrl+Space";
  return `${event.metaKey || event.ctrlKey ? "Mod+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${key}`;
}
export function matchesShortcut(event: KeyboardEvent, binding: string) {
  if (!binding || event.defaultPrevented || event.repeat || event.isComposing) return false;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest(
      "input,textarea,select,[contenteditable=true],[role=combobox],[role=listbox],[role=dialog],[role=alertdialog],[role=menu]",
    )
  )
    return false;
  return recordedShortcut(event) === binding;
}
