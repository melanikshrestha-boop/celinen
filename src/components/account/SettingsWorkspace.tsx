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
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DEFAULT_PREFERENCES, type AccountPreferences } from "@/lib/account-preferences";
import {
  SETTINGS_SECTIONS,
  searchSettings,
  settingsSection,
  type SettingsSection,
} from "@/lib/settings-catalog";
import { exportSettings, importSettings } from "@/lib/settings-transfer";
import { nativeEngineStatus } from "@/lib/studio/native-client";
import "./settings-workspace.css";

const icons = [
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
  UserRound,
  Monitor,
  History,
  Scan,
  Plug,
  Globe,
  Workflow,
  GitBranch,
  Cpu,
  FolderOpen,
];
type ExistingSection = "account" | "appearance" | "chat" | "connections" | "privacy" | "shortcuts";
function Row({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      {children && <div className="settings-control">{children}</div>}
    </div>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-label={title}>
      <h2>{title}</h2>
      <div className="settings-group-rows">{children}</div>
    </section>
  );
}
function Choice({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  change: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, label]) => (
          <SelectItem value={key} key={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
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
  const hash = useRouterState({ select: (state) => state.location.hash });
  const section = settingsSection(hash.replace(/^#/, ""));
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef(section);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    setNotice("");
    setFailure("");
    if (previousSection.current !== section) heading.current?.focus({ preventScroll: true });
    previousSection.current = section;
  }, [section]);
  if (!account || account.status !== "in") return null;
  const prefs = account.preferences;
  const save = (patch: Partial<AccountPreferences>) => {
    try {
      account.savePreferences(patch);
      setNotice("Saved on this browser");
      setFailure("");
      return true;
    } catch {
      setFailure("Could not save. Allow browser storage and try again.");
      setNotice("");
      return false;
    }
  };
  const pick = (id: SettingsSection) => {
    void navigate({ search: true, hash: id, replace: true }).then(() => {
      setQuery("");
      setMenu(false);
    });
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
      | "showPet",
  ) => (
    <Switch
      aria-label={label}
      disabled={key === "cloudAssistant" && account.local}
      checked={key === "cloudAssistant" && account.local ? false : prefs[key]}
      onCheckedChange={(value) => save({ [key]: value })}
    />
  );
  const results = searchSettings(query);
  const label = SETTINGS_SECTIONS.find((entry) => entry.id === section)!.label;
  const page = () => {
    switch (section) {
      case "general":
        return (
          <>
            <Group title="Permissions">
              <Row
                title="Default permissions"
                note="Read the photos you choose. Edits stay reversible and never overwrite originals."
              >
                {fixed("Protected")}
              </Row>
              <Row
                title="Cloud assistant"
                note={
                  account.local
                    ? "Cloud services are off in this development workspace. This preference applies when using a verified account."
                    : "Allow unmatched prompts and current shoot metadata to reach the hosted assistant. Local commands still work when off."
                }
              >
                {toggle("Cloud assistant", "cloudAssistant")}
              </Row>
              <Row
                title="Full computer access"
                note="LensLabs cannot control your desktop or read arbitrary folders from a web page."
              >
                <span className="settings-capability">Not available on web</span>
              </Row>
            </Group>
            <Group title="General">
              <Row
                title="Shoot storage"
                note="Photos and edits stay on this browser until you explicitly export or publish."
              >
                {action("Manage shoots", "/projects")}
              </Row>
              <Row
                title="Default file open destination"
                note="Imported photographs open in the Studio attached to your current shoot."
              >
                {fixed("LensLabs Studio")}
              </Row>
              <Row title="Language" note="The interface is currently available in English.">
                <span>English</span>
              </Row>
              <Row
                title="Prevent sleep while processing"
                note="Request a screen wake lock during imports and local processing. Works while this tab is visible in supported browsers."
              >
                {toggle("Prevent sleep while processing", "keepAwake")}
              </Row>
              <Row
                title="Processing speed"
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
          </>
        );
      case "import":
        return (
          <Group title="Photos & sidecars">
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
        return (
          <>
            {renderExisting("appearance")}
            <Group title="Interaction">
              <Row
                title="Use pointer cursors"
                note="Show a pointer over clickable workspace controls."
              >
                {toggle("Use pointer cursors", "pointerCursors")}
              </Row>
            </Group>
          </>
        );
      case "voice":
        return <VoiceSettings prefs={prefs} save={save} />;
      case "configuration":
        return <Configuration prefs={prefs} save={save} />;
      case "personalization":
        return <Personalization prefs={prefs} save={save} local={account.local} />;
      case "pets":
        return (
          <Group title="Your companion">
            <Row
              title="Show pet"
              note="A small companion beside your workspace. Hide it any time with Control+Space."
            >
              {toggle("Show pet", "showPet")}
            </Row>
            <Row title="Companion">
              <Choice
                label="Companion"
                value={prefs.pet}
                options={[
                  ["cat", "Cat"],
                  ["dog", "Dog"],
                ]}
                change={(value) => save({ pet: value as AccountPreferences["pet"] })}
              />
            </Row>
            <div className="settings-pet-preview" aria-label={`${prefs.pet} preview`}>
              <span aria-hidden="true">{prefs.pet === "cat" ? "🐈" : "🐕"}</span>
              <span>{prefs.showPet ? "Awake in your workspace" : "Tucked away"}</span>
            </div>
          </Group>
        );
      case "shortcuts":
        return (
          <>
            {renderExisting("chat")}
            <Group title="Keyboard shortcuts">
              {renderExisting("shortcuts")}
              <Row title="Show or hide pet">
                <kbd>Ctrl + Space</kbd>
              </Row>
            </Group>
          </>
        );
      case "usage":
        return (
          <>
            <Group title="Plan">
              <Row
                title={account.local ? "Development workspace" : "Account billing"}
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
            </Group>
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
          <>
            <Group title="Conversations in this shoot">
              <div className="settings-history">
                <ChatRecents />
              </div>
            </Group>
            <Group title="Computer history">
              <Row
                title="Desktop activity"
                note="No desktop activity is recorded. Conversation history contains messages and tool receipts, not a replay of actions."
              >
                {fixed("Not recorded")}
              </Row>
            </Group>
          </>
        );
      case "appshots":
        return (
          <Group title="Reference captures">
            <Row
              title="Import a screenshot"
              note="Choose or drop a screenshot into Studio like any other image. LensLabs does not capture other apps automatically."
            >
              {action("Open Studio", "/studio")}
            </Row>
            <Row
              title="Automatic app capture"
              note="Appshots is a native desktop capability, not an enabled browser permission."
            >
              <span className="settings-capability">Not available on web</span>
            </Row>
          </Group>
        );
      case "plugins":
        return renderExisting("connections");
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
          <Group title="Reviewable workflow actions">
            <Row
              title="Proof to final"
              note="Create a private draft, collect selections and revision requests, then publish approved finals."
            >
              {action("Open delivery", "/deliver")}
            </Row>
            <Row title="Client follow-ups" note="Track clients and their next steps.">
              {action("Open clients", "/clients")}
            </Row>
            <Row
              title="Social & portfolio publishing"
              note="Prepare a post and review it before publishing to a connected account."
            >
              {action("Open publishing", "/publish")}
            </Row>
            <Row
              title="Unattended hooks"
              note="Shell scripts, arbitrary webhooks and automatic publishing are not enabled."
            >
              {fixed("Review first")}
            </Row>
          </Group>
        );
      case "versions":
        return (
          <Group title="Non-destructive editing">
            <Row
              title="Before & after"
              note="Preview edits in Studio before applying. Original files remain unchanged."
            >
              {action("Open Studio", "/studio")}
            </Row>
            <Row title="Undo photo changes" note="Undo changes in the current editing session.">
              <kbd>⌘ / Ctrl + Z</kbd>
            </Row>
            <Row
              title="Export a recoverable copy"
              note="Use project exports for backups, and Adobe XMP for supported edit settings."
            >
              {action("Open projects", "/projects")}
            </Row>
            <Row
              title="Git & worktrees"
              note="Code repositories are not part of a photography workspace. Separate shoots and delivery versions keep work organized."
            >
              <span className="settings-capability">Adapted for photography</span>
            </Row>
          </Group>
        );
      case "environments":
        return <Environment local={account.local} />;
      case "shoots":
        return (
          <Group title="Shoots & workspaces">
            <Row
              title="Recent Shoots"
              note="Your imported shoots stay available in the sidebar. Starting a new shoot never erases another one."
            >
              {action("Back to workspace", "/workspace")}
            </Row>
            <Row
              title="Multiple tabs per shoot"
              note="Open Studio, Delivery, Clients and research within the same shoot using the + button on its tab strip."
            >
              {action("Open Studio", "/studio")}
            </Row>
            <Row title="Workspace name" note={account.workspaceName}>
              <button className="settings-button" onClick={() => pick("profile")}>
                Change
              </button>
            </Row>
          </Group>
        );
    }
  };
  return (
    <div className="settings-shell">
      <aside className={`settings-rail ${menu ? "is-open" : ""}`} aria-label="Settings navigation">
        <button className="settings-back" onClick={() => void workbench?.openTool("/workspace")}>
          <ArrowLeft size={17} />
          Back to app
        </button>
        <div className="settings-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && results[0]) pick(results[0].id);
            }}
          />
          {query && (
            <button aria-label="Clear settings search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <nav aria-label="Settings sections">
          {["Personal", "Integrations", "Photography"].map((group) => (
            <div className="settings-nav-group" key={group}>
              <p>{group}</p>
              {SETTINGS_SECTIONS.filter((entry) => entry.group === group).map((entry) => {
                const Icon = icons[SETTINGS_SECTIONS.indexOf(entry)]!;
                return (
                  <button
                    key={entry.id}
                    aria-current={!query && section === entry.id ? "page" : undefined}
                    onClick={() => pick(entry.id)}
                  >
                    <Icon size={17} />
                    <span>{entry.label}</span>
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
            aria-label={menu ? "Close settings navigation" : "Open settings navigation"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={19} /> : <Menu size={19} />}
          </button>
          <span>Settings</span>
          <button className="settings-back" onClick={() => void workbench?.openTool("/workspace")}>
            <ArrowLeft size={16} />
            Back
          </button>
        </div>
        <div className="settings-content">
          <h1 ref={heading} tabIndex={-1}>
            {query.trim() ? "Search settings" : label}
          </h1>
          {query.trim() && (
            <div className="settings-search-results">
              <p role="status">
                {results.length} {results.length === 1 ? "section" : "sections"} matching “{query}”
              </p>
              {results.map((entry) => (
                <button key={entry.id} onClick={() => pick(entry.id)}>
                  <span>
                    {entry.label}
                    <small>{entry.group}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
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
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportSettings(prefs)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lenslabs-settings.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <Group title="Portable preferences">
        <Row
          title="Export settings"
          note="Includes this browser’s preferences and custom instructions. No account credentials, photos or chat history."
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
            if (file.size > 16_384) {
              setError("Choose a settings file smaller than 16 KB.");
              return;
            }
            void file
              .text()
              .then((text) => {
                setPending(importSettings(text));
                setError("");
              })
              .catch((error: unknown) =>
                setError(error instanceof Error ? error.message : "Could not read this file."),
              );
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
                : "This replaces preferences and custom instructions on this browser, including the cloud-assistant preference. Imported settings do not sign you in or run any actions."}{" "}
              Your photos, profile and conversations are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (save(reset ? DEFAULT_PREFERENCES : pending!)) {
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
  const dirty = instructions !== prefs.customInstructions;
  useToolLeaveGuard(dirty ? "Your custom instructions have unsaved changes." : null);
  useEffect(() => {
    setInstructions(prefs.customInstructions);
  }, [prefs.customInstructions]);
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
              ["none", "None"],
              ["friendly", "Friendly"],
              ["concise", "Concise"],
            ]}
            change={(value) => save({ personality: value as AccountPreferences["personality"] })}
          />
        </Row>
      </Group>
      <form
        className="settings-instructions"
        onSubmit={(e) => {
          e.preventDefault();
          save({ customInstructions: instructions });
        }}
      >
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
        </div>
      </form>
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
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    setSupported("speechSynthesis" in window);
    return () => {
      if (utterance.current) {
        utterance.current.onend = null;
        utterance.current.onerror = null;
        window.speechSynthesis?.cancel();
      }
    };
  }, []);
  return (
    <Group title="Read aloud">
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
      <Row title="Preview voice" note="Uses your browser’s default voice. No microphone is opened.">
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
            text.onend = () => setPlaying(false);
            text.onerror = () => {
              setPlaying(false);
              setNote("Voice playback was unavailable. Check your browser’s audio permissions.");
            };
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
