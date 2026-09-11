/** The settings index is also used by search; never index account data or secrets. */
export const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    group: "Personal",
    terms:
      "permissions full access cloud assistant default destination language prevent sleep keep awake speed suggested prompts completion notifications sound",
  },
  {
    id: "import",
    label: "Import",
    group: "Personal",
    terms: "photos folder RAW JPEG Adobe Lightroom XMP sidecars originals",
  },
  {
    id: "profile",
    label: "Profile",
    group: "Personal",
    terms:
      "name workspace identity avatar photographer photography specialty specialties real estate portrait biography",
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "Personal",
    terms: "black light theme text size reduce motion sidebar pointer cursors",
  },
  {
    id: "voice",
    label: "Voice",
    group: "Personal",
    terms: "speech read aloud playback rate speed voice selection dictation microphone",
  },
  {
    id: "configuration",
    label: "Configuration",
    group: "Personal",
    terms: "export import settings JSON backup reset",
  },
  {
    id: "personalization",
    label: "Personalization",
    group: "Personal",
    terms:
      "custom instructions personality friendly concise assistant learn photos edits style training",
  },
  { id: "pets", label: "Pets", group: "Personal", terms: "show hide cat dog companion" },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    group: "Personal",
    terms: "keys send message enter command control undo keep reject navigation chat",
  },
  {
    id: "usage",
    label: "Usage & billing",
    group: "Personal",
    terms: "storage quota capacity plan subscription payment",
  },
  {
    id: "analytics",
    label: "Analytics",
    group: "Personal",
    terms: "shoot statistics photos keepers rejects",
  },
  {
    id: "account",
    label: "Account",
    group: "Personal",
    terms: "email sign in session logout privacy data protection backup",
  },
  {
    id: "computer",
    label: "Computer use",
    group: "Integrations",
    terms: "permissions screen recording accessibility full access native desktop",
  },
  {
    id: "history",
    label: "Computer history",
    group: "Integrations",
    terms: "computer history archived chats conversations receipts",
  },
  {
    id: "appshots",
    label: "Appshots",
    group: "Integrations",
    terms: "screenshots screen capture reference images",
  },
  {
    id: "plugins",
    label: "Plugins",
    group: "Integrations",
    terms: "Gmail Google Instagram portfolio Adobe Lightroom plugins integrations",
  },
  {
    id: "browser",
    label: "Browser",
    group: "Integrations",
    terms: "web research search sources links new tabs",
  },
  {
    id: "hooks",
    label: "Hooks",
    group: "Coding",
    terms: "hooks delivery publishing automation clients reminders",
  },
  {
    id: "connections",
    label: "Connections",
    group: "Coding",
    terms:
      "Gmail Google Instagram Adobe Lightroom provider authorization scope reconnect disconnect",
  },
  {
    id: "versions",
    label: "Git",
    group: "Coding",
    terms: "git undo revisions edits before after XMP backup",
  },
  {
    id: "environments",
    label: "Environments",
    group: "Coding",
    terms: "C++ native engine browser processing cloud development lab",
  },
  {
    id: "shoots",
    label: "Worktrees",
    group: "Coding",
    terms: "worktrees new shoot recent projects tabs archive",
  },
  {
    id: "archived",
    label: "Archived",
    group: "Standalone",
    terms: "unarchive restore conversations history",
  },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
const slugs: Partial<Record<SettingsSection, string>> = {
  shortcuts: "keyboard-shortcuts",
  usage: "usage-billing",
  computer: "computer-use",
  history: "computer-history",
  versions: "git",
  shoots: "worktrees",
};
export function settingsPath(section: SettingsSection) {
  return `/settings/${slugs[section] ?? section}`;
}
export function isSettingsPath(path: string) {
  return path === "/settings" || SETTINGS_SECTIONS.some((entry) => settingsPath(entry.id) === path);
}
export function settingsSection(value: unknown): SettingsSection {
  // Old account/settings links continue to resolve after the navigation expansion.
  const alias =
    value === "privacy"
      ? "account"
      : value === "notifications"
        ? "general"
        : value === "chat"
          ? "shortcuts"
          : value;
  return (
    SETTINGS_SECTIONS.find(
      (section) => section.id === alias || slugs[section.id as keyof typeof slugs] === alias,
    )?.id ?? "general"
  );
}
export function searchSettings(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return SETTINGS_SECTIONS.filter((section) =>
    words.every((word) =>
      `${section.label} ${section.group} ${section.terms}`.toLocaleLowerCase().includes(word),
    ),
  );
}
