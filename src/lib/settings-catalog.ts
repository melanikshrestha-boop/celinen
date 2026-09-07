/** The settings index is also used by search; never index account data or secrets. */
export const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    group: "Personal",
    terms:
      "permissions full access cloud assistant default destination language prevent sleep keep awake speed suggested prompts",
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
    terms: "name workspace identity Celine avatar",
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
    terms: "speech read aloud playback rate speed dictation microphone",
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
    terms: "custom instructions personality friendly concise assistant",
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
    label: "Activity history",
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
    label: "Plugins & connections",
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
    label: "Workflow actions",
    group: "Photography",
    terms: "hooks delivery publishing automation clients reminders",
  },
  {
    id: "versions",
    label: "Versions & originals",
    group: "Photography",
    terms: "git undo revisions edits before after XMP backup",
  },
  {
    id: "environments",
    label: "Environments",
    group: "Photography",
    terms: "C++ native engine browser processing cloud development lab",
  },
  {
    id: "shoots",
    label: "Shoots & workspaces",
    group: "Photography",
    terms: "worktrees new shoot recent projects tabs archive",
  },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export function settingsSection(value: unknown): SettingsSection {
  // Old account/settings links continue to resolve after the navigation expansion.
  const alias =
    value === "privacy"
      ? "account"
      : value === "connections"
        ? "plugins"
        : value === "chat"
          ? "shortcuts"
          : value;
  return SETTINGS_SECTIONS.find((section) => section.id === alias)?.id ?? "general";
}
export function searchSettings(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return SETTINGS_SECTIONS.filter((section) =>
    words.every((word) =>
      `${section.label} ${section.group} ${section.terms}`.toLocaleLowerCase().includes(word),
    ),
  );
}
