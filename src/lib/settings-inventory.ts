import { DEFAULT_PREFERENCES } from "./account-preferences";
import { SETTINGS_SECTIONS, type SettingsSection } from "./settings-catalog";
import { SHORTCUTS } from "./shortcuts";

export const settingId = (title: string) =>
  `setting-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
type Control = {
  page: SettingsSection;
  label: string;
  description: string;
  type: "preference" | "action" | "status" | "unavailable";
  preference?: keyof typeof DEFAULT_PREFERENCES;
};
const rows = (
  page: SettingsSection,
  type: Control["type"],
  labels: string[],
  description: string,
): Control[] => labels.map((label) => ({ page, label, type, description }));
const preferences: [SettingsSection, string, keyof typeof DEFAULT_PREFERENCES, string][] = [
  [
    "general",
    "Language",
    "language",
    "English Spanish Español navigation and assistant replies; detailed help remains English",
  ],
  [
    "general",
    "Default file open destination",
    "fileDestination",
    "Studio Adobe XMP sidecar export or Finder Files folder import picker",
  ],
  ["general", "Appearance", "theme", "Dark Light or System appearance"],
  [
    "general",
    "Cloud assistant",
    "cloudAssistant",
    "Allow hosted prompts and shoot metadata; never bypass approvals",
  ],
  [
    "personalization",
    "Learn from your photos and edits",
    "learnFromYourWork",
    "Remember your saved looks for you only; originals stay read-only; not a shared model",
  ],
  [
    "general",
    "Prevent sleep while running",
    "keepAwake",
    "Screen wake lock while processing in a visible tab",
  ],
  [
    "general",
    "Speed",
    "processingSpeed",
    "Balanced parallel workers or Gentle single import worker",
  ],
  ["general", "Suggested prompts", "suggestedPrompts", "Example commands in empty chats"],
  [
    "general",
    "Show notifications",
    "completionNotifications",
    "Task completion notifications always when away or never",
  ],
  [
    "general",
    "Desktop notifications",
    "desktopNotifications",
    "Browser permission required for operating system alerts",
  ],
  ["general", "Send a message", "sendKey", "Enter or modifier Enter; Shift Enter multiline"],
  [
    "import",
    "Read Adobe XMP sidecars",
    "importSidecars",
    "Supported Adobe Lightroom ratings and develop settings on subsequent imports",
  ],
  ["appearance", "Use pointer cursors", "pointerCursors", "Pointer over interactive controls"],
  ["appearance", "Reduce motion", "reduceMotion", "Reduce animation and smooth scrolling"],
  ["appearance", "Keep sidebar open", "sidebarOpen", "Workspace navigation visibility"],
  ["voice", "Voice", "voiceURI", "Read-aloud voice available in this browser"],
  ["voice", "Playback speed", "voiceRate", "Read-aloud playback rate"],
  ["pets", "Show pet", "showPet", "Optional in-app companion, off by default"],
  ["pets", "Companion", "pet", "Cat or dog"],
  [
    "configuration",
    "Import concurrency",
    "processingSpeed",
    "Effective RAW and image worker counts; personal preference with enforced bounds",
  ],
  [
    "pets",
    "Companion animation",
    "petAnimation",
    "Optional blink; respects reduced motion; not task status",
  ],
  [
    "pets",
    "Companion position",
    "petPosition",
    "Non-interactive companion in left or right corner",
  ],
  ["browser", "Open research sources", "openSources", "External links in this or another tab"],
  ["personalization", "Personality", "personality", "Hosted reply tone, not permissions"],
  [
    "personalization",
    "Response detail",
    "responseDetail",
    "Brief balanced or detailed hosted answers",
  ],
];
const controls: Control[] = [
  ...rows(
    "configuration",
    "status",
    ["Native health timeout", "Native session retry limit", "Approval policy", "Processing engine"],
    "Effective runtime policy; cannot be overridden by imported preferences",
  ),
  ...rows(
    "pets",
    "action",
    ["Reset companion position", "Companion image"],
    "Reset the corner or explicitly save a cropped local JPEG image. We'll design more.",
  ),
  ...rows(
    "general",
    "status",
    ["Photo edits need your approval", "New chats start fresh", "Browser permission"],
    "Current browser and workspace policy, not a permission grant",
  ),
  ...rows("general", "action", ["Preview notification"], "Send a generic local test notification"),
  ...rows(
    "profile",
    "action",
    ["Profile details"],
    "Display name photographer specialties custom specialty avatar crop replacement removal and biography; explicit save or cancel; private identity",
  ),
  ...rows(
    "profile",
    "status",
    ["Stay signed in", "Sign-in method"],
    "Verified authentication outside the development lab",
  ),
  ...rows("appearance", "preference", ["Color mode"], "Dark Light or System browser appearance"),
  ...rows(
    "appearance",
    "action",
    ["Import theme", "Export theme", "Undo theme change", "Reset theme"],
    "Bounded validated data with explicit confirmation for import and reset",
  ),
  ...rows(
    "voice",
    "action",
    ["Input device"],
    "Choose a browser microphone after explicit permission; selection lasts for this test page",
  ),
  ...rows(
    "personalization",
    "action",
    ["Custom instructions"],
    "Preferred terminology and personal instructions, private bounded text; explicit save and cancel",
  ),
  ...rows(
    "shortcuts",
    "preference",
    SHORTCUTS.map((entry) => entry.label),
    "Real command bindings; conflicts and unsupported chords rejected",
  ),
  ...rows(
    "shortcuts",
    "status",
    ["Previous or next photo", "Undo photo change", "Show or hide sidebar", "New line in chat"],
    "Fixed contextual keyboard navigation",
  ),
  ...rows(
    "account",
    "status",
    ["Browser storage"],
    "Actual origin storage estimate, not a per-account cloud quota",
  ),
  ...rows(
    "usage",
    "status",
    ["Originals stay read-only", "Assistant data"],
    "Current app data handling",
  ),
  ...rows(
    "usage",
    "action",
    ["Protect local files from automatic cleanup"],
    "Browser-granted persistent storage only",
  ),
  ...rows(
    "history",
    "unavailable",
    ["Sources and retention"],
    "No computer-activity collector or sources configured",
  ),
  ...rows(
    "appshots",
    "unavailable",
    ["Accessible text"],
    "Browser capture provides an image, not another app's accessibility tree",
  ),
  ...rows(
    "hooks",
    "unavailable",
    ["Execution and logs"],
    "No hook execution environment installed",
  ),
  ...rows(
    "environments",
    "status",
    ["Workspace", "Photo processing"],
    "Actual browser runtime and optional native photo engine readiness",
  ),
  ...rows(
    "environments",
    "action",
    ["Check engine again"],
    "Read-only native engine readiness request",
  ),
  ...rows("environments", "unavailable", ["Background execution"], "No unattended worker runtime"),
  ...rows(
    "shoots",
    "unavailable",
    ["Active tasks and uncommitted changes"],
    "No Git worktree runtime",
  ),
  ...rows(
    "archived",
    "action",
    ["Archived conversations"],
    "View and restore archived chats for this shoot without deleting photos",
  ),
  ...preferences.map(([page, label, preference, description]) => ({
    page,
    label,
    preference,
    description,
    type: "preference" as const,
  })),
  ...rows(
    "general",
    "status",
    ["Default permissions", "Projectless task folder"],
    "Browser workspace policy; user-selected files only",
  ),
  ...rows(
    "general",
    "unavailable",
    [
      "Full access",
      "Show in menu bar",
      "Bottom panel",
      "Default terminal location",
      "Notification sounds",
      "Follow-up messages",
    ],
    "Requires an implementation beyond this runtime; no permissions granted",
  ),
  ...rows(
    "appearance",
    "preference",
    [
      "Dark theme",
      "Background",
      "Foreground",
      "UI font",
      "Code font",
      "Interface size",
      "Code size",
      "Density",
      "Translucent sidebar",
    ],
    "Live appearance, validated colors and allowlisted fonts; device-local",
  ),
  ...(["general", "appearance"] as const).flatMap((page) =>
    rows(
      page,
      "preference",
      [
        "Contrast",
        "Accent color",
        "Custom accent",
        "Accent style",
        "Gradient end",
        "Workspace grid",
      ],
      "System standard or increased contrast; gray blue green yellow pink orange purple white presets; validated hex color codes; optional gradient and canvas grid",
    ),
  ),
  ...rows(
    "appearance",
    "status",
    ["Text contrast"],
    "Computed contrast ratio; invalid colors rejected",
  ),
  ...rows(
    "import",
    "action",
    ["Import photos or a folder", "Adobe presets & settings"],
    "Open the existing controlled Studio import workflow",
  ),
  ...rows("import", "status", ["Original files"], "Read-only originals"),
  ...rows(
    "voice",
    "action",
    ["Preview voice", "Microphone test"],
    "Explicit user action; no automatic recording",
  ),
  ...rows(
    "voice",
    "unavailable",
    ["Live voice conversation"],
    "No speech recognition or hands-free command service connected",
  ),
  ...rows(
    "configuration",
    "action",
    ["Export settings", "Import settings", "Reset preferences"],
    "Versioned bounded JSON; preview and confirmation, no secrets",
  ),
  ...rows(
    "usage",
    "status",
    ["Account billing", "Browser storage", "Usage engine", "Photos tallied"],
    "C++ SETT/SRES tally plus actual browser storage estimate, not a cloud billing balance",
  ),
  ...rows(
    "analytics",
    "action",
    ["Current shoot insights", "Business activity"],
    "Existing recorded shoot counts and business records",
  ),
  ...rows("analytics", "unavailable", ["Lifetime usage"], "Not tracked; no invented statistics"),
  ...rows(
    "account",
    "status",
    ["Signed in as", "Sign out", "Originals stay read-only", "Assistant data"],
    "Verified account outside development lab; no credential export",
  ),
  ...rows(
    "account",
    "action",
    ["Profile details", "Protect local files from automatic cleanup"],
    "Existing profile and browser storage actions",
  ),
  ...rows(
    "account",
    "action",
    ["Invite a friend"],
    "Copy a public signup link, share it or open an email draft; never shares shoots",
  ),
  ...rows(
    "computer",
    "unavailable",
    ["Computer use", "Background screen recording"],
    "No authorized native computer-control component",
  ),
  ...rows("computer", "status", ["File access"], "Only user-selected files"),
  ...rows(
    "history",
    "unavailable",
    ["Activity collection"],
    "Computer History is not chat history; no collection engine connected",
  ),
  ...rows(
    "appshots",
    "action",
    ["Capture a view"],
    "Explicit browser screen capture with preview before download; no automatic upload",
  ),
  ...rows(
    "plugins",
    "unavailable",
    ["Plugin runtime"],
    "No installable plugin executor or verified registry",
  ),
  ...rows(
    "plugins",
    "action",
    ["Discover"],
    "Opens Connections for real provider screens; no plugin store",
  ),
  ...rows(
    "browser",
    "action",
    ["Web search"],
    "Configured search provider or manual browser search",
  ),
  ...rows(
    "browser",
    "unavailable",
    ["Control other websites"],
    "No browser automation extension or shared browser session",
  ),
  ...rows(
    "hooks",
    "unavailable",
    ["Event-triggered hooks"],
    "No controlled hook dispatcher; no commands run on import",
  ),
  ...rows(
    "connections",
    "action",
    ["Gmail", "Web search", "Adobe & Lightroom", "Instagram & portfolio"],
    "Real provider screens; readiness and grants remain with existing integrations",
  ),
  ...rows(
    "versions",
    "unavailable",
    ["Git repository", "Inline or detached review"],
    "No authorized Git executor in the web app",
  ),
  ...rows(
    "shoots",
    "unavailable",
    ["Git worktrees"],
    "Requires authorized repository runtime; not copied photo projects",
  ),
];
/** Shared search/inventory IDs. Never includes account content, secrets or uploaded configuration. */
export const SETTINGS_CONTROLS = controls.map((control) => ({
  ...control,
  id: settingId(control.label),
  default: control.preference ? DEFAULT_PREFERENCES[control.preference] : null,
  scope:
    control.type === "preference"
      ? "account-scoped device preference"
      : "runtime / current workspace",
  validation: control.preference
    ? "preferencesSchema, strict and bounded"
    : control.page === "appearance"
      ? "appearanceSchema; contrast >= 4.5:1"
      : "capability and authorization checked by existing action",
  permissions:
    control.type === "unavailable"
      ? "not granted"
      : "ordinary preference is not an authorization grant",
  backend: ["connections", "account", "usage"].includes(control.page)
    ? "existing authenticated provider where configured"
    : "browser / local runtime",
  status: control.type === "unavailable" ? "unavailable" : "implemented",
}));
export function searchSettingControls(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS_CONTROLS.filter((control) =>
    words.every((word) =>
      `${control.label} ${control.description} ${SETTINGS_SECTIONS.find((page) => page.id === control.page)!.label}`
        .toLowerCase()
        .includes(word),
    ),
  );
}
