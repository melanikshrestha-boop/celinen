import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Search,
  X,
  Settings2,
  Download,
  UserRound,
  Sun,
  Mic,
  Shield,
  Sparkles,
  Cat,
  Keyboard,
  Gauge,
  ChartNoAxesCombined,
  Monitor,
  History,
  Scan,
  Plug,
  Globe,
  Workflow,
  GitBranch,
  Cpu,
  FolderOpen,
  Check,
  Menu,
  Archive,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AppearanceBasics } from "./AppearanceBasics";
import { useWorkspaceText } from "./useWorkspaceText";
import { useChatHistory } from "@/components/workbench/ChatHistory";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useWorkbench } from "@/components/workbench/context";
import { ChatRecents } from "@/components/workbench/ChatHistory";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { useAccount } from "./AccountProvider";
import { AccountMenu } from "./AccountMenu";
import { InviteFriendDialog } from "./InviteFriendDialog";
import { DEFAULT_PREFERENCES, type AccountPreferences } from "@/lib/account-preferences";
import {
  SETTINGS_SECTIONS,
  searchSettings,
  settingsSection,
  settingsPath,
  type SettingsSection,
} from "@/lib/settings-catalog";
import {
  exportSettings,
  importSettings,
  previewSettingsImport,
  SETTINGS_FILE_MAX_BYTES,
  importLanes,
} from "@/lib/settings-transfer";
import { nativeEngineStatus, NATIVE_REQUEST_POLICY } from "@/lib/studio/native-client";
import {
  decodeSettingsUsage,
  encodeSettingsUsage,
  formatUsageBytes,
  tallySettingsUsageLocal,
  type SettingsUsageResult,
} from "@/lib/settings-usage";
import { findSpeechVoice } from "@/lib/speech-voice";
import { notifyResponseReady } from "@/lib/workspace-notifications";
import { AppearanceSettings } from "./AppearanceSettings";
import { CaptureSettings } from "./CaptureSettings";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { PetSettings } from "./PetSettings";
import { searchSettingControls } from "@/lib/settings-inventory";
import {
  SettingsRow as Row,
  SettingsGroup as Group,
  SettingsChoice as Choice,
} from "./SettingsPrimitives";
import "./settings-workspace.css";

const icons: Record<SettingsSection, typeof Settings2> = {
  general: Settings2,
  import: Download,
  profile: UserRound,
  appearance: Sun,
  voice: Mic,
  configuration: Shield,
  personalization: Sparkles,
  pets: Cat,
  shortcuts: Keyboard,
  usage: Gauge,
  analytics: ChartNoAxesCombined,
  account: UserRound,
  computer: Monitor,
  history: History,
  appshots: Scan,
  plugins: Plug,
  browser: Globe,
  hooks: Workflow,
  connections: Globe,
  versions: GitBranch,
  environments: Cpu,
  shoots: FolderOpen,
  archived: Archive,
};
type ExistingSection = "account" | "appearance" | "chat" | "connections" | "privacy" | "shortcuts";
const fixed = (text: string) => (
  <span className="settings-fixed">
    <Check size={14} />
    {text}
  </span>
);

export function SettingsWorkspace({
  renderExisting,
}: {
  renderExisting: (section: ExistingSection) => ReactNode;
}) {
  const account = useAccount();
  const workbench = useWorkbench();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const section = settingsSection(
    location.pathname.startsWith("/settings/")
      ? location.pathname.split("/")[2]
      : location.hash.replace(/^#/, ""),
  );
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [menu, setMenu] = useState(false);
  const [invite, setInvite] = useState(false);
  const inviteTrigger = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const rail = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const previousSection = useRef(section);
  useEffect(() => {
    document.title = `${SETTINGS_SECTIONS.find((entry) => entry.id === section)!.label} — Celinen Settings`;
    content.current?.scrollTo({ top: 0 });
    setNotice("");
    setFailure("");
    if (previousSection.current !== section) heading.current?.focus({ preventScroll: true });
    previousSection.current = section;
  }, [section]);
  useEffect(() => {
    if (location.pathname === "/settings")
      void navigate({ to: settingsPath(section), search: true, hash: "", replace: true });
  }, [location.pathname, section, navigate]);
  useEffect(() => {
    if (!location.hash.startsWith("setting-")) return;
    let target: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      target = document.getElementById(location.hash);
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
      target?.classList.add("settings-highlight");
      timer = setTimeout(() => target?.classList.remove("settings-highlight"), 2400);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      target?.classList.remove("settings-highlight");
    };
  }, [location.hash, section, query]);
  useEffect(() => {
    setSearchIndex(0);
  }, [query]);
  useEffect(() => {
    if (!menu) return;
    rail.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
      if (event.key !== "Tab") return;
      const entries = [
        ...(rail.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input,a[href]") ??
          []),
      ].filter((node) => node.offsetParent !== null);
      const first = entries[0],
        last = entries.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu]);
  const t = useWorkspaceText();
  const chatHistory = useChatHistory();
  if (!account || account.status !== "in") return null;
  const prefs = account.preferences;
  const save = (patch: Partial<AccountPreferences>) => {
    try {
      account.savePreferences(patch);
      setNotice("Saved on this browser");
      setFailure("");
      return true;
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not save. Allow browser storage and try again.",
      );
      setNotice("");
      return false;
    }
  };
  const pick = (id: SettingsSection, row = "") => {
    void navigate({ to: settingsPath(id), search: true, hash: row }).then(() => {
      setQuery("");
      setMenu(false);
    });
  };
  const backToApp = () => {
    let destination = workbench ? "/workspace" : "/dashboard";
    try {
      const saved = sessionStorage.getItem(`lenslabs.settings-return:${account.scope}`);
      if (
        saved?.startsWith("/") &&
        !saved.startsWith("//") &&
        !saved.startsWith("/settings") &&
        !saved.startsWith("/auth")
      ) {
        const url = new URL(saved, window.location.origin);
        const current = new URL(window.location.href);
        if (
          url.origin === current.origin &&
          url.searchParams.get("shoot") === current.searchParams.get("shoot") &&
          url.searchParams.get("workspaceProject") === current.searchParams.get("workspaceProject")
        )
          destination = saved;
      }
    } catch {
      /* Fall back to the photographer home. */
    }
    if (workbench) void workbench.openTool(destination);
    else void navigate({ href: destination });
  };
  const action = (label: string, href: string) => (
    <button className="settings-button" onClick={() => void workbench?.openTool(href)}>
      {label}
      <ArrowUpRight size={14} />
    </button>
  );
  const toggle = (
    label: string,
    key:
      | "cloudAssistant"
      | "suggestedPrompts"
      | "keepAwake"
      | "importSidecars"
      | "pointerCursors"
      | "showPet"
      | "learnFromYourWork",
  ) => (
    <Switch
      aria-label={label}
      disabled={key === "cloudAssistant" && account.local}
      checked={key === "cloudAssistant" && account.local ? false : prefs[key]}
      onCheckedChange={(value) => {
        save({ [key]: value });
        if (key === "learnFromYourWork" && !value) {
          void import("@/lib/personal-style").then((m) => m.clearPersonalStyle());
        }
      }}
    />
  );
  const matchedControls = searchSettingControls(query);
  const results = [
    ...matchedControls,
    ...searchSettings(query)
      .filter((entry) => !matchedControls.some((control) => control.page === entry.id))
      .map((entry) => ({
        page: entry.id,
        id: "",
        label: entry.label,
        description: `${entry.group} settings`,
      })),
  ];
  const label = SETTINGS_SECTIONS.find((entry) => entry.id === section)!.label;
  const page = () => {
    switch (section) {
      case "general":
        return (
          <>
            <Group title="Permissions">
              <Row
                title="Default permissions"
                note="By default, LensLabs can read and edit files in the current workspace. It asks before accessing additional locations or performing restricted actions. In this browser, only chosen files are readable; edits create reversible instructions, not changes to originals."
              >
                {fixed("Protected")}
              </Row>
              <Row
                title="Full access"
                note="Allow LensLabs to perform supported actions beyond the current workspace without asking each time. This increases the risk of unintended changes, data loss, or exposing private information. This browser has no elevated execution service: arbitrary file access, shell commands and external app control are unavailable."
              >
                <Switch aria-label="Full access" checked={false} disabled />
              </Row>
            </Group>
            <Group title="General">
              <AppearanceBasics prefs={prefs} save={save} mode />
              <Row
                title="Projectless task folder"
                note="The default location for files created outside a project. This web edition uses this browser’s LensLabs storage, not an unrestricted filesystem folder."
              >
                {action("Manage shoots", "/projects")}
              </Row>
              <Row
                title="Default file open destination"
                note="Choose a workflow for Open shoot files. Adobe downloads XMP; Finder / Files opens a folder picker for import. A browser cannot launch a desktop editor directly."
              >
                <div className="settings-destination">
                  <Choice
                    label="Default file open destination"
                    value={prefs.fileDestination}
                    options={[
                      ["studio", "LensLabs Studio"],
                      ["adobe", "Adobe · XMP export"],
                      ["folder", "Finder / Files · import folder"],
                    ]}
                    change={(value) =>
                      save({ fileDestination: value as AccountPreferences["fileDestination"] })
                    }
                  />
                  <button
                    className="settings-button"
                    onClick={() => {
                      if (prefs.fileDestination === "studio") {
                        void workbench?.showStudio();
                        return;
                      }
                      if (prefs.fileDestination === "adobe" && chatHistory?.active) {
                        window.dispatchEvent(
                          new CustomEvent("lenslabs:chat-dialog", { detail: { action: "adobe" } }),
                        );
                        return;
                      }
                      let handled = false;
                      window.dispatchEvent(
                        new CustomEvent("lenslabs:open-folder", {
                          detail: {
                            respond: (message: string) => {
                              handled = true;
                              setNotice(message);
                            },
                          },
                        }),
                      );
                      if (!handled)
                        setNotice(
                          "Open Studio and wait for this shoot to load, then choose a folder.",
                        );
                    }}
                  >
                    Open shoot files
                  </button>
                </div>
              </Row>
              <Row
                title="Language"
                note="Navigation, settings labels and assistant replies. Detailed help and some tools currently remain in English."
              >
                <Choice
                  label="Language"
                  value={prefs.language}
                  options={[
                    ["en", "English"],
                    ["es", "Español"],
                    ["auto", "Auto-detect"],
                  ]}
                  change={(language) =>
                    save({ language: language as AccountPreferences["language"] })
                  }
                />
              </Row>
              <Row
                title="Show in menu bar"
                note="A macOS menu-bar item requires a native desktop application."
              >
                <Switch aria-label="Show in menu bar" disabled checked={false} />
              </Row>
              <Row
                title="Bottom panel"
                note="There is no bottom-panel runtime in this edition. Existing shoot tool tabs remain available."
              >
                <Switch aria-label="Bottom panel" disabled checked={false} />
              </Row>
              <Row
                title="Default terminal location"
                note="No shell or terminal sessions run in this browser workspace."
              >
                <span className="settings-capability">Not connected</span>
              </Row>
              <Row
                title="Prevent sleep while running"
                note="Request a screen wake lock during imports and local processing. Works while this tab is visible in supported browsers."
              >
                <div className="settings-inline-actions">
                  <WakeStatus />
                  {toggle("Prevent sleep while running", "keepAwake")}
                </div>
              </Row>
              <Row
                title="Speed"
                note="Balanced uses parallel workers. Gentle uses one import worker to reduce memory pressure."
              >
                <Choice
                  label="Processing speed"
                  value={prefs.processingSpeed}
                  options={[
                    ["balanced", "Balanced"],
                    ["gentle", "Gentle"],
                  ]}
                  change={(value) =>
                    save({ processingSpeed: value as AccountPreferences["processingSpeed"] })
                  }
                />
              </Row>
              <Row
                title="Suggested prompts"
                note="Show example commands in an empty chat. Suggestions fill the composer; they do not run on their own."
              >
                {toggle("Suggested prompts", "suggestedPrompts")}
              </Row>
            </Group>
            <Group title="Assistant">
              <Row
                title="Learn from your photos and edits"
                note="Remembers looks you save so FOTO gets closer to your eye. Originals stay read-only. Not a shared model. Off deletes the local log."
              >
                {toggle("Learn from your photos and edits", "learnFromYourWork")}
              </Row>
              <Row
                title="Cloud assistant"
                note={
                  account.local
                    ? "Disabled by the development runtime. A preference cannot override this restriction."
                    : "Allow unmatched messages and shoot metadata to reach the hosted assistant. Local commands continue when off."
                }
              >
                {toggle("Cloud assistant", "cloudAssistant")}
              </Row>
              {renderExisting("chat")}
              <Row
                title="Follow-up messages"
                note="Mid-task steering and a queued follow-up dispatcher are not implemented. Send again after the current response settles."
              >
                <span className="settings-capability">After completion</span>
              </Row>
            </Group>
            <NotificationSettings prefs={prefs} save={save} />
            <Group title="Sounds">
              <Row
                title="Notification sounds"
                note="Sound notifications are not connected. Existing in-app and browser alerts remain available."
              >
                <Switch aria-label="Notification sounds" disabled checked={false} />
              </Row>
            </Group>
          </>
        );
      case "import":
        return (
          <Group title="Photos & sidecars">
            <Row
              title="Bring your website content"
              note="Review saved HTML, Pixieset folder CSV or a FOTO migration plan. Existing sites and domains stay untouched."
            >
              {action("Review website import", "/portfolio")}
            </Row>
            <Row
              title="Import photos or a folder"
              note="Use the + menu in Chat or drop a folder into Studio. Existing photos are preserved."
            >
              {action("Open Studio", "/studio")}
            </Row>
            <Row
              title="Read Adobe XMP sidecars"
              note="Apply supported Lightroom develop settings, ratings and picks from sidecars beside newly imported files. Does not change photos already imported."
            >
              {toggle("Read Adobe XMP sidecars", "importSidecars")}
            </Row>
            <Row
              title="Original files"
              note="RAW and JPEG originals are never moved, rewritten or deleted during import."
            >
              {fixed("Read-only")}
            </Row>
            <Row
              title="Adobe presets & settings"
              note="Paste supported Adobe settings into Chat to preview them before applying."
            >
              {action("Open Adobe", "/adobe")}
            </Row>
          </Group>
        );
      case "profile":
        return renderExisting("account");
      case "appearance":
        return <AppearanceSettings prefs={prefs} save={save} />;
      case "voice":
        return (
          <>
            <MicrophoneSettings />
            <VoiceSettings prefs={prefs} save={save} />
          </>
        );
      case "configuration":
        return <Configuration prefs={prefs} save={save} />;
      case "personalization":
        return <Personalization prefs={prefs} save={save} local={account.local} />;
      case "pets":
        return <PetSettings prefs={prefs} save={save} />;
      case "shortcuts":
        return <ShortcutSettings />;
      case "usage":
        return (
          <>
            <UsageTally />
            <Group title="Plan">
              <Row
                title="Account billing"
                note={
                  account.local
                    ? "No paid plan, billing identity or cloud allowance is attached to this local profile."
                    : "A live subscription meter is not connected here. No estimated credits are presented as an account balance."
                }
              >
                <span className="settings-capability">
                  {account.local ? "Local only" : "Not connected"}
                </span>
              </Row>
            </Group>
            {renderExisting("privacy")}
          </>
        );
      case "analytics":
        return (
          <Group title="Your photography">
            <Row
              title="Current shoot insights"
              note="Studio shows actual photo counts, keepers, rejects and review progress for your shoot."
            >
              {action("Open shoot", "/studio")}
            </Row>
            <Row
              title="Business activity"
              note="Review recorded clients and revenue in your business workspace."
            >
              {action("Open earnings", "/earnings")}
            </Row>
            <Row
              title="Lifetime usage"
              note="Lifetime AI-token charts and activity streaks are not tracked by LensLabs."
            >
              <span className="settings-capability">Not tracked</span>
            </Row>
          </Group>
        );
      case "account":
        return (
          <>
            <Group title="Identity">
              <Row
                title="Signed in as"
                note={
                  account.local
                    ? "Development persona. No authentication session has been created."
                    : account.user?.email
                }
              >
                {account.name}
              </Row>
              <Row
                title="Profile details"
                note="Change your display name without renaming or removing your shoots."
              >
                <button className="settings-button" onClick={() => pick("profile")}>
                  Edit profile
                </button>
              </Row>
              <Row
                title="Sign out"
                note="Use your profile menu below. Unsaved work is checked before leaving."
              >
                {account.local ? "Close local workspace" : "This browser only"}
              </Row>
              <Row
                title="Invite a friend"
                note="Share a signup link. Your photos, chats and workspace stay private."
              >
                <button
                  ref={inviteTrigger}
                  className="settings-button"
                  onClick={() => setInvite(true)}
                >
                  Invite a friend
                </button>
              </Row>
            </Group>
            <InviteFriendDialog
              open={invite}
              onOpenChange={setInvite}
              returnFocus={inviteTrigger}
            />
            {renderExisting("privacy")}
          </>
        );
      case "computer":
        return (
          <Group title="Desktop permissions">
            <Row
              title="Computer use"
              note="This browser edition does not click other applications or request macOS Accessibility access."
            >
              <span className="settings-capability">Desktop app required</span>
            </Row>
            <Row
              title="File access"
              note="Only files you explicitly choose or drop into LensLabs can be imported."
            >
              {fixed("Selected files only")}
            </Row>
            <Row
              title="Background screen recording"
              note="LensLabs does not monitor your desktop or record other applications."
            >
              {fixed("Off")}
            </Row>
          </Group>
        );
      case "history":
        return (
          <Group title="Computer history">
            <Row
              title="Activity collection"
              note="No application-interaction collection or summarization service is connected. Chat messages are not Computer History. LensLabs does not collect other applications, private browsing, passwords or keystrokes."
            >
              <Switch aria-label="Activity collection" checked={false} disabled />
            </Row>
            <Row
              title="Sources and retention"
              note="No activity sources are enabled and no activity summaries are stored. There is nothing to pause, export or delete."
            >
              <span className="settings-capability">None</span>
            </Row>
          </Group>
        );
      case "archived":
        return (
          <Group title="Archived conversations in this shoot">
            <div
              className="settings-history"
              id="setting-archived-conversations"
              data-setting-id="setting-archived-conversations"
              tabIndex={-1}
            >
              <ChatRecents archivedOnly />
            </div>
            <p className="settings-footnote">
              Restore a conversation from its menu. Archiving never removes your photos.
            </p>
          </Group>
        );
      case "appshots":
        return <CaptureSettings />;
      case "connections":
        return renderExisting("connections");
      case "plugins":
        return (
          <Group title="Installed plugins">
            <Row
              title="Plugin runtime"
              note="No installable plugin execution layer is connected to this browser application. Provider connections are managed separately."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
            <Row
              title="Discover"
              note="Open Connections for Gmail, search, Adobe and portfolio links. No plugin store."
            >
              <button className="settings-button" onClick={() => pick("connections")}>
                Connections
              </button>
            </Row>
          </Group>
        );
      case "browser":
        return (
          <Group title="Research & links">
            <Row
              title="Open research sources"
              note="Choose where links in the Web research panel open. This does not change the shoot’s internal tool tabs."
            >
              <Choice
                label="Open research sources"
                value={prefs.openSources}
                options={[
                  ["new-tab", "New browser tab"],
                  ["same-tab", "Current browser tab"],
                ]}
                change={(value) =>
                  save({ openSources: value as AccountPreferences["openSources"] })
                }
              />
            </Row>
            <Row
              title="Web search"
              note="Search with the configured provider, or open a search in your browser."
            >
              {action("Open search", "/research")}
            </Row>
            <Row
              title="Control other websites"
              note="No browser extension or unattended website-control permission is installed by LensLabs."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
          </Group>
        );
      case "hooks":
        return (
          <Group title="Event-triggered automation">
            <Row
              title="Event-triggered hooks"
              note="No controlled hook dispatcher is installed. Settings files cannot register commands, enable publishing or send webhooks. Manual delivery and publishing remain separate reviewed actions."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
            <Row
              title="Execution and logs"
              note="No shell execution environment, hook history or external side effects are configured."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
          </Group>
        );
      case "versions":
        return (
          <Group title="Repository">
            <Row
              title="Git repository"
              note="No authorized Git execution environment is connected to LensLabs. A photo’s edit history is not a Git repository. This page cannot inspect branches, stage, commit, merge or push."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
            <Row
              title="Inline or detached review"
              note="Git diff review modes require a repository runtime and are not implemented here."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
          </Group>
        );
      case "environments":
        return <Environment local={account.local} />;
      case "shoots":
        return (
          <Group title="Parallel Git checkouts">
            <Row
              title="Git worktrees"
              note="A worktree is a separate checkout attached to one Git repository, not a duplicated photo project. Creating, inspecting or removing one requires an authorized Git runtime; none is connected."
            >
              <span className="settings-capability">Not connected</span>
            </Row>
            <Row
              title="Active tasks and uncommitted changes"
              note="No worktree state is accessible. LensLabs does not assume ignored files, credentials or unsaved changes are copied."
            >
              {fixed("No runtime")}
            </Row>
          </Group>
        );
    }
  };
  return (
    <div className="settings-shell">
      <aside
        ref={rail}
        className={`settings-rail ${menu ? "is-open" : ""}`}
        aria-label="Settings navigation"
      >
        <button className="settings-back" onClick={backToApp}>
          <ArrowLeft size={17} />
          {t("Back to app")}
        </button>
        <div className="settings-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search settings"
            placeholder={t("Search settings…")}
            role="combobox"
            aria-expanded={Boolean(query.trim())}
            aria-controls="settings-results"
            aria-activedescendant={
              query.trim() && results[searchIndex] ? `settings-result-${searchIndex}` : undefined
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSearchIndex((index) => Math.max(0, Math.min(results.length - 1, index + 1)));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSearchIndex((index) => Math.max(0, index - 1));
              }
              if (e.key === "Enter" && results[searchIndex]) {
                e.preventDefault();
                pick(results[searchIndex].page, results[searchIndex].id);
              }
            }}
          />
          {query && (
            <button aria-label="Clear settings search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <nav aria-label="Settings sections">
          {["Personal", "Integrations", "Coding", "Standalone"].map((group) => (
            <div className="settings-nav-group" key={group}>
              {group !== "Standalone" && <p>{t(group)}</p>}
              {SETTINGS_SECTIONS.filter((entry) => entry.group === group).map((entry) => {
                const Icon = icons[entry.id] ?? Settings2;
                return (
                  <button
                    key={entry.id}
                    data-section={entry.id}
                    aria-current={!query && section === entry.id ? "page" : undefined}
                    onClick={() => pick(entry.id)}
                  >
                    <Icon size={17} />
                    <span>{t(entry.label)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="settings-rail-profile">
          <AccountMenu />
        </div>
      </aside>
      <div className="settings-main" ref={content}>
        <div className="settings-mobile-header">
          <button
            ref={menuButton}
            aria-label={menu ? "Close settings navigation" : "Open settings navigation"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={19} /> : <Menu size={19} />}
          </button>
          <span>{t(label)}</span>
          <button className="settings-back" onClick={backToApp}>
            <ArrowLeft size={16} />
            Back
          </button>
        </div>
        <div className="settings-content" inert={menu}>
          <h1 ref={heading} tabIndex={-1}>
            {t(query.trim() ? "Search settings" : label)}
          </h1>
          {query.trim() && (
            <div className="settings-search-results">
              <p role="status">
                {results.length} {results.length === 1 ? "result" : "results"} matching “{query}”
              </p>
              <div id="settings-results" role="listbox" aria-label="Matching settings">
                {results.map((entry, index) => (
                  <button
                    id={`settings-result-${index}`}
                    role="option"
                    aria-selected={index === searchIndex}
                    key={`${entry.page}:${entry.id}`}
                    onClick={() => pick(entry.page, entry.id)}
                  >
                    <span>
                      {t(entry.label)}
                      <small>
                        {SETTINGS_SECTIONS.find((page) => page.id === entry.page)!.label} ·{" "}
                        {entry.description}
                      </small>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
              {!results.length && <p>Try “theme”, “sidecars”, “privacy” or “shortcuts”.</p>}
            </div>
          )}
          <div hidden={Boolean(query.trim())}>{page()}</div>
          <div className="settings-save-feedback" aria-live="polite">
            {failure ? (
              <p role="alert">{failure}</p>
            ) : notice ? (
              <p>
                <Check size={14} />
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageTally() {
  const [engine, setEngine] = useState("Checking…");
  const [tally, setTally] = useState<SettingsUsageResult | null>(null);
  useEffect(() => {
    let alive = true;
    const photos: { bytes: number; kept: boolean }[] = [];
    void (async () => {
      try {
        const status = await fetch("/__settings/usage/status", { cache: "no-store" });
        const body = status.ok ? ((await status.json()) as { ready?: boolean }) : null;
        const packet = encodeSettingsUsage(photos);
        if (body?.ready) {
          const response = await fetch("/__settings/usage", {
            method: "POST",
            body: packet,
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Settings tally failed.");
          const result = decodeSettingsUsage(new Uint8Array(await response.arrayBuffer()));
          if (alive) {
            setEngine("C++ engine");
            setTally(result);
          }
          return;
        }
        if (alive) {
          setEngine("Browser tally");
          setTally(tallySettingsUsageLocal(photos));
        }
      } catch {
        if (alive) {
          setEngine("Browser tally");
          setTally(tallySettingsUsageLocal(photos));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Group title="This browser">
      <Row title="Usage engine">
        <span className="settings-capability">{engine}</span>
      </Row>
      <Row title="Photos tallied">
        <span className="settings-capability">
          {tally
            ? `${tally.photos} · ${tally.kept} kept · ${formatUsageBytes(tally.totalBytes)}`
            : "…"}
        </span>
      </Row>
    </Group>
  );
}
function WakeStatus() {
  const [status, setStatus] = useState("Not requested");
  useEffect(() => {
    const read = () => {
      const state = document.documentElement.dataset["processingWakeLock"];
      setStatus(
        !navigator.wakeLock
          ? "Browser unsupported"
          : state === "active"
            ? "Active"
            : state === "unavailable"
              ? "Unavailable"
              : state === "released"
                ? "Released"
                : "Not requested",
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-processing-wake-lock"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <span className="settings-capability" role="status">
      {status}
    </span>
  );
}

function Configuration({
  prefs,
  save,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<AccountPreferences | null>(null);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState("");
  const baseline = useRef(prefs);
  const generation = useRef(0);
  const hardware = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useToolLeaveGuard(
    pending || reset ? "A settings change is waiting for your confirmation." : null,
  );
  const preview = pending ? previewSettingsImport(baseline.current, pending) : null;
  const download = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([exportSettings(prefs)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "lenslabs-settings.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export preferences.");
    }
  };
  return (
    <>
      <Group title="Effective configuration">
        <Row
          title="Import concurrency"
          note={`Personal preference on this browser · default Balanced. Effective: ${importLanes(true, hardware, prefs.processingSpeed)} RAW workers, ${importLanes(false, hardware, prefs.processingSpeed)} other image workers. Applies to the next import.`}
        >
          <Choice
            label="Import concurrency"
            value={prefs.processingSpeed}
            options={[
              ["balanced", "Balanced"],
              ["gentle", "Gentle"],
            ]}
            change={(value) =>
              save({ processingSpeed: value as AccountPreferences["processingSpeed"] })
            }
          />
        </Row>
        <Row
          title="Native health timeout"
          note="Enforced application policy · time allowed to check the local C++ engine. Not a processing deadline."
        >
          <span className="settings-capability">
            {NATIVE_REQUEST_POLICY.healthTimeoutMs / 1000} seconds
          </span>
        </Row>
        <Row
          title="Native session retry limit"
          note="Enforced application policy · retry only after an expired local session returns 403. Other failures are not replayed automatically."
        >
          <span className="settings-capability">{NATIVE_REQUEST_POLICY.maxAttempts - 1} retry</span>
        </Row>
        <Row
          title="Approval policy"
          note="Enforced application policy · proposed edits require approval. Imported preferences cannot grant native access, enable cloud sharing, run hooks or publish a gallery."
        >
          {fixed("Review before applying")}
        </Row>
        <Row
          title="Processing engine"
          note="The local C++ engine is checked in Environments. This web build has no user-selectable hosted model or arbitrary command executor."
        >
          <span className="settings-capability">Runtime managed</span>
        </Row>
      </Group>
      <Group title="Portable preferences">
        <Row
          title="Export settings"
          note="Includes this browser’s preferences, companion image and custom instructions. No account credentials, shoot photos or chat history."
        >
          <button className="settings-button" onClick={download}>
            Export JSON
            <Download size={14} />
          </button>
        </Row>
        <Row
          title="Import settings"
          note="Review before replacing preferences. Your profile, photos and conversations are not changed."
        >
          <button className="settings-button" onClick={() => picker.current?.click()}>
            Choose file
          </button>
        </Row>
        <input
          hidden
          ref={picker}
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const ticket = ++generation.current;
            baseline.current = prefs;
            if (file.size > SETTINGS_FILE_MAX_BYTES) {
              setError("Choose a settings file smaller than 32 KB.");
              return;
            }
            void file
              .text()
              .then((text) => {
                if (ticket !== generation.current) return;
                setPending(importSettings(text));
                setError("");
              })
              .catch((error: unknown) => {
                if (ticket === generation.current)
                  setError(error instanceof Error ? error.message : "Could not read this file.");
              });
          }}
        />
        <Row
          title="Reset preferences"
          note="Restore LensLabs defaults on this browser. Does not delete photos, conversations or your profile."
        >
          <button
            className="settings-button"
            onClick={() => {
              setError("");
              baseline.current = prefs;
              setReset(true);
            }}
          >
            Reset…
          </button>
        </Row>
      </Group>
      {error && <p role="alert">{error}</p>}
      <AlertDialog
        open={!!pending || reset}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setReset(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reset ? "Reset preferences?" : "Import these settings?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reset
                ? "Your preferences and custom instructions will return to their defaults."
                : "Review the changes below. Imports cannot enable cloud sharing or desktop notifications. They never sign you in or run actions."}{" "}
              Your photos, profile and conversations are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && (
            <div className="settings-import-diff">
              <p>{preview.changed.length} changed preferences</p>
              <ul>
                {preview.changed.map((key) => (
                  <li key={key}>
                    <code>{key}</code>:{" "}
                    {key === "petImage"
                      ? "Companion image replaced"
                      : key === "customInstructions"
                        ? "Custom instructions replaced (review the file before applying)"
                        : `${JSON.stringify(baseline.current[key])} → ${JSON.stringify(preview.preferences[key])}`}
                  </li>
                ))}
              </ul>
              {preview.blocked.length > 0 && (
                <p>Not enabled: {preview.blocked.join(", ")}. Grant these separately in General.</p>
              )}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (JSON.stringify(baseline.current) !== JSON.stringify(prefs)) {
                  setError(
                    "Settings changed while this preview was open. Cancel and review the import again.",
                  );
                  return;
                }
                const target = reset
                  ? previewSettingsImport(prefs, DEFAULT_PREFERENCES).preferences
                  : preview!.preferences;
                if (save(target)) {
                  setError("");
                  setPending(null);
                  setReset(false);
                } else {
                  setError("Could not save preferences. Allow browser storage, then try again.");
                }
              }}
            >
              Apply preferences
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function Personalization({
  prefs,
  save,
  local,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
  local: boolean;
}) {
  const [instructions, setInstructions] = useState(prefs.customInstructions);
  const [terms, setTerms] = useState(prefs.preferredTerms);
  const [error, setError] = useState("");
  const baseline = useRef({ instructions: prefs.customInstructions, terms: prefs.preferredTerms });
  const dirty = instructions !== baseline.current.instructions || terms !== baseline.current.terms;
  useToolLeaveGuard(dirty ? "Your custom instructions have unsaved changes." : null);
  useEffect(() => {
    if (!dirty) {
      baseline.current = { instructions: prefs.customInstructions, terms: prefs.preferredTerms };
      setInstructions(prefs.customInstructions);
      setTerms(prefs.preferredTerms);
    }
  }, [prefs.customInstructions, prefs.preferredTerms, dirty]);
  return (
    <>
      <Group title="Assistant style">
        <Row
          title="Personality"
          note="Applies to future hosted assistant replies, not fixed local command receipts."
        >
          <Choice
            label="Personality"
            value={prefs.personality}
            options={[
              ["none", "Neutral"],
              ["friendly", "Friendly"],
              ["concise", "Pragmatic"],
            ]}
            change={(value) => save({ personality: value as AccountPreferences["personality"] })}
          />
        </Row>
        <Row
          title="Response detail"
          note="Changes how future hosted replies explain decisions, not their permissions."
        >
          <Choice
            label="Response detail"
            value={prefs.responseDetail}
            options={[
              ["balanced", "Balanced"],
              ["brief", "Brief"],
              ["detailed", "Detailed"],
            ]}
            change={(value) =>
              save({ responseDetail: value as AccountPreferences["responseDetail"] })
            }
          />
        </Row>
        <p className="settings-footnote">
          {prefs.personality === "friendly"
            ? "Preview: Let’s start with your strongest frames, then review the close calls together."
            : prefs.personality === "concise"
              ? "Preview: Review sharpness, expressions, then duplicates. Confirm the keepers."
              : "Preview: Review the suggested selections before applying changes."}
        </p>
      </Group>
      <form
        className="settings-instructions"
        id="setting-custom-instructions"
        data-setting-id="setting-custom-instructions"
        tabIndex={-1}
        onSubmit={(e) => {
          e.preventDefault();
          if (
            baseline.current.instructions !== prefs.customInstructions ||
            baseline.current.terms !== prefs.preferredTerms
          ) {
            setError(
              "These instructions changed in another tab. Cancel to load the current values before saving.",
            );
            return;
          }
          if (save({ customInstructions: instructions, preferredTerms: terms })) {
            baseline.current = { instructions, terms };
            setError("");
          }
        }}
      >
        <label htmlFor="preferred-terms">Preferred terminology</label>
        <textarea
          id="preferred-terms"
          aria-label="Preferred terminology"
          rows={2}
          maxLength={300}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
        />
        <p>
          Personal preferences apply to future hosted chats. This app has no separate
          project-instruction override or persistent assistant-memory store.
        </p>
        <label htmlFor="personal-instructions">Custom instructions</label>
        <p>
          Tell the assistant about your style, preferred terminology or editing goals. Do not
          include passwords or client secrets.
        </p>
        <textarea
          id="personal-instructions"
          rows={7}
          maxLength={2000}
          placeholder="I photograph interiors. Keep colors natural and protect window highlights…"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div>
          <span>{instructions.length} / 2,000</span>
          <button className="settings-button" disabled={!dirty}>
            Save instructions
          </button>
          {dirty && (
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                baseline.current = {
                  instructions: prefs.customInstructions,
                  terms: prefs.preferredTerms,
                };
                setInstructions(prefs.customInstructions);
                setTerms(prefs.preferredTerms);
                setError("");
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {local && (
        <p className="settings-footnote">
          Saved here for development. Hosted personalization only runs in a connected, signed-in
          workspace.
        </p>
      )}
    </>
  );
}
function VoiceSettings({
  prefs,
  save,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    setSupported("speechSynthesis" in window);
    const refresh = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    refresh();
    window.speechSynthesis?.addEventListener("voiceschanged", refresh);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", refresh);
      if (utterance.current) {
        utterance.current.onend = null;
        utterance.current.onerror = null;
        window.speechSynthesis?.cancel();
      }
    };
  }, []);
  return (
    <Group title="Read aloud">
      <Row
        title="Voice"
        note="Uses voices available in your browser. Some voices use an online speech service."
      >
        <Choice
          label="Read-aloud voice"
          value={prefs.voiceURI || "browser-default"}
          options={[
            ["browser-default", "Browser default"],
            ...(prefs.voiceURI && !findSpeechVoice(voices, prefs.voiceURI)
              ? [[prefs.voiceURI, "Saved voice unavailable"] as const]
              : []),
            ...Array.from(new Map(voices.map((voice) => [voice.voiceURI, voice])).values())
              .filter((voice) => voice.voiceURI && voice.voiceURI !== "browser-default")
              .map((voice) => [voice.voiceURI, `${voice.name} · ${voice.lang}`] as const),
          ]}
          change={(value) => save({ voiceURI: value === "browser-default" ? "" : value })}
        />
      </Row>
      <Row title="Playback speed" note="Used by read-aloud controls on assistant replies.">
        <Choice
          label="Playback speed"
          value={String(prefs.voiceRate)}
          options={[
            ["0.75", "0.75×"],
            ["1", "1×"],
            ["1.25", "1.25×"],
            ["1.5", "1.5×"],
            ["2", "2×"],
          ]}
          change={(value) => save({ voiceRate: Number(value) })}
        />
      </Row>
      <Row title="Preview voice" note="Listen to the selected voice. No microphone is opened.">
        <button
          className="settings-button"
          disabled={!supported}
          onClick={() => {
            if (playing) {
              window.speechSynthesis.cancel();
              setPlaying(false);
              return;
            }
            const text = new SpeechSynthesisUtterance(
              "Your shoot is ready to review. Your originals stay untouched.",
            );
            utterance.current = text;
            text.rate = prefs.voiceRate;
            text.voice = findSpeechVoice(window.speechSynthesis.getVoices(), prefs.voiceURI);
            text.onend = () => {
              if (utterance.current !== text) return;
              setPlaying(false);
              utterance.current = null;
            };
            text.onerror = (event) => {
              if (utterance.current !== text) return;
              setPlaying(false);
              utterance.current = null;
              if (!["canceled", "interrupted"].includes(event.error))
                setNote("Voice playback was unavailable. Check your browser’s audio permissions.");
            };
            setNote("");
            window.speechSynthesis.cancel();
            setPlaying(true);
            window.speechSynthesis.speak(text);
          }}
        >
          {playing ? "Stop preview" : "Play preview"}
        </button>
      </Row>
      <Row
        title="Live voice conversation"
        note="Realtime microphone conversations are not connected in this browser edition."
      >
        <span className="settings-capability">Not connected</span>
      </Row>
      {note && <p role="status">{note}</p>}
    </Group>
  );
}
function NotificationSettings({
  prefs,
  save,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
}) {
  const [permission, setPermission] = useState<NotificationPermission | "unavailable">(
    "unavailable",
  );
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    const read = () =>
      setPermission("Notification" in window ? Notification.permission : "unavailable");
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  return (
    <>
      <Group title="Chat completion">
        <Row
          title="Show notifications"
          note="Let me know when a new response is ready. Saved conversations never trigger alerts."
        >
          <Choice
            label="Show notifications"
            value={prefs.completionNotifications}
            options={[
              ["always", "Always"],
              ["unfocused", "When away"],
              ["off", "Never"],
            ]}
            change={(value) =>
              save({
                completionNotifications: value as AccountPreferences["completionNotifications"],
              })
            }
          />
        </Row>
        <Row
          title="Desktop notifications"
          note="While LensLabs is open, use a silent system notification when allowed, or an in-app alert. Background push after closing the app is not connected."
        >
          <Switch
            aria-label="Desktop notifications"
            checked={prefs.desktopNotifications}
            disabled={permission === "unavailable"}
            onCheckedChange={(value) => save({ desktopNotifications: value })}
          />
        </Row>
        <Row
          title="Browser permission"
          note={
            permission === "denied"
              ? "Notifications are blocked. You can change this in your browser’s site settings."
              : "Permission is requested only when you press Allow notifications."
          }
        >
          {permission === "default" ? (
            <button
              className="settings-button"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void Notification.requestPermission()
                  .then(setPermission)
                  .catch(() =>
                    setNote(
                      "Permission could not be requested. Check this browser’s site settings.",
                    ),
                  )
                  .finally(() => setPending(false));
              }}
            >
              {pending ? "Waiting…" : "Allow notifications"}
            </button>
          ) : (
            <span className="settings-capability">
              {permission === "granted"
                ? "Allowed"
                : permission === "denied"
                  ? "Blocked"
                  : "Unavailable in this browser"}
            </span>
          )}
        </Row>
        <Row
          title="Preview notification"
          note="Sends a generic test alert using the selected delivery method."
        >
          <button
            className="settings-button"
            onClick={() => {
              const delivered = notifyResponseReady({
                ...prefs,
                completionNotifications: "always",
              });
              setNote(
                delivered === "desktop"
                  ? "Test sent to your system notification center."
                  : "Test shown in LensLabs.",
              );
            }}
          >
            Send test
          </button>
        </Row>
      </Group>
      <p className="settings-footnote">
        Alerts contain no photo previews, filenames, client names or message content. They work
        while LensLabs is open, not after the browser is closed.
      </p>
      {note && <p role="status">{note}</p>}
    </>
  );
}
function Environment({ local }: { local: boolean }) {
  const [engine, setEngine] = useState("Checking…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setEngine("Checking…");
    void nativeEngineStatus().then((value) => {
      if (alive) setEngine(value?.ready ? "C++ engine ready" : "Browser processing");
    });
    return () => {
      alive = false;
    };
  }, [attempt]);
  return (
    <Group title="Runtime">
      <Row
        title="Workspace"
        note={
          local
            ? "Isolated local development origin. Cloud calls, real accounts and publishing are blocked."
            : "Verified account. Browser-local photos remain separate from published gallery copies."
        }
      >
        {local ? "Development" : "Connected account"}
      </Row>
      <Row
        title="Photo processing"
        note="Native readiness is checked against the local engine, not inferred from a setting."
      >
        <span>{engine}</span>
      </Row>
      <Row title="Check engine again">
        <button className="settings-button" onClick={() => setAttempt((value) => value + 1)}>
          Refresh
        </button>
      </Row>
      <Row
        title="Background execution"
        note="Browser tabs can be suspended. Long-running unattended jobs require a separate native or server worker."
      >
        <span className="settings-capability">Foreground browser</span>
      </Row>
    </Group>
  );
}
