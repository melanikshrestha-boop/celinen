import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Keyboard,
  Mail,
  MessageSquare,
  Palette,
  Shield,
  UserRound,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useWorkbench } from "@/components/workbench/context";
import { useGmail } from "@/components/workbench/GmailConnection";
import {
  accountInitials,
  DEFAULT_PREFERENCES,
  displayNameSchema,
  type AccountPreferences,
} from "@/lib/account-preferences";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { webSearchReadiness } from "@/lib/connections/research.functions";
import "@/components/account/account.css";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LensLabs" }] }),
  component: Settings,
});
const SECTIONS = [
  ["account", "Account", UserRound],
  ["appearance", "Appearance", Palette],
  ["chat", "Chat", MessageSquare],
  ["connections", "Connections", Mail],
  ["privacy", "Data & privacy", Shield],
  ["shortcuts", "Keyboard shortcuts", Keyboard],
] as const;
type Section = (typeof SECTIONS)[number][0];
function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}
function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map(([id, text]) => (
          <SelectItem key={id} value={id}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Settings() {
  const account = useAccount();
  const workbench = useWorkbench();
  const [section, setSection] = useState<Section>("account");
  const [name, setName] = useState(account?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
    persisted: boolean;
  } | null>(null);
  useEffect(() => {
    setName(account?.name ?? "");
  }, [account?.name]);
  const save = (patch: Partial<AccountPreferences>) => {
    try {
      account?.savePreferences(patch);
      setError("");
      setNote("Saved on this browser.");
    } catch {
      setNote("");
      setError("Could not save this preference. Allow browser storage, then try again.");
    }
  };
  const measure = async () => {
    try {
      if (!navigator.storage?.estimate)
        throw new Error("This browser does not report storage usage.");
      const [estimate, persisted] = await Promise.all([
        navigator.storage.estimate(),
        navigator.storage.persisted?.() ?? false,
      ]);
      setStorage({ ...estimate, persisted });
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Storage could not be checked.");
    }
  };
  useEffect(() => {
    if (section === "privacy") void measure();
  }, [section]);
  if (!account || account.status !== "in") return null;
  const prefs = account.preferences;
  return (
    <section className="account-settings" aria-label="Settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>Make room for the way you work.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                setSection(id);
                setNote("");
                setError("");
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-detail">
          <h2>{SECTIONS.find(([id]) => id === section)?.[1]}</h2>
          {section === "account" && (
            <>
              <div className="settings-profile">
                <span className="account-avatar large">{accountInitials(account.name)}</span>
                <div>
                  <strong>{account.name}</strong>
                  <p>{account.local ? "Local profile · this device only" : account.user?.email}</p>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsed = displayNameSchema.safeParse(name);
                  if (!parsed.success) {
                    setError(parsed.error.issues[0]?.message ?? "Check your name.");
                    return;
                  }
                  setSaving(true);
                  setError("");
                  setNote("");
                  void account
                    .saveName(parsed.data)
                    .then(() =>
                      setNote(
                        account.local
                          ? "Profile saved on this device."
                          : "Profile saved to your account.",
                      ),
                    )
                    .catch((error: unknown) =>
                      setError(
                        error instanceof Error ? error.message : "Profile could not be saved.",
                      ),
                    )
                    .finally(() => setSaving(false));
                }}
              >
                <label className="settings-label" htmlFor="profile-display-name">
                  Display name
                </label>
                <div className="settings-name-field">
                  <input
                    id="profile-display-name"
                    autoComplete="name"
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={saving}
                  />
                  <button
                    className="settings-button primary"
                    type="submit"
                    disabled={saving || name.trim() === account.name || !name.trim()}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
              <Row
                title={account.local ? "Local workspace" : "Remembered sign-in"}
                note={
                  account.local
                    ? "This development profile is not a cloud account or a security lock. Your saved shoot stays here when you close it."
                    : "This browser restores your session and refreshes it automatically. Log out from the profile menu when you're done on a shared computer."
                }
              >
                <Check size={17} />
              </Row>
              {!account.local && (
                <Row
                  title="Email address"
                  note="Your sign-in address. Changing a display name does not change it."
                >
                  <span className="settings-email">{account.user?.email}</span>
                </Row>
              )}
              <p className="settings-footnote">
                {account.local
                  ? "Cloud accounts require the hosted sign-in flow. Local photos are never silently assigned to another account."
                  : "A revoked or expired session, browser data clearing, or your account's security policy can require signing in again."}
              </p>
            </>
          )}
          {section === "appearance" && (
            <>
              <p className="settings-intro">
                Saved for your profile on this browser. Changes apply immediately.
              </p>
              <Row title="Appearance">
                <Choice
                  label="Theme"
                  value={prefs.theme}
                  values={[
                    ["dark", "Black"],
                    ["light", "Light"],
                  ]}
                  onChange={(theme) => save({ theme: theme as AccountPreferences["theme"] })}
                />
              </Row>
              <Row title="Chat text size">
                <Choice
                  label="Chat text size"
                  value={prefs.textSize}
                  values={[
                    ["default", "Default"],
                    ["large", "Large"],
                  ]}
                  onChange={(textSize) =>
                    save({ textSize: textSize as AccountPreferences["textSize"] })
                  }
                />
              </Row>
              <Row
                title="Reduce motion"
                note="Disable decorative animation and smooth chat scrolling."
              >
                <Switch
                  aria-label="Reduce motion"
                  checked={prefs.reduceMotion}
                  onCheckedChange={(reduceMotion) => save({ reduceMotion })}
                />
              </Row>
              <Row title="Keep sidebar open" note="You can also toggle it with ⌘B or Ctrl+B.">
                <Switch
                  aria-label="Keep sidebar open"
                  checked={prefs.sidebarOpen}
                  onCheckedChange={(sidebarOpen) => save({ sidebarOpen })}
                />
              </Row>
              <button
                className="settings-text-action"
                onClick={() =>
                  save({
                    theme: DEFAULT_PREFERENCES.theme,
                    textSize: DEFAULT_PREFERENCES.textSize,
                    reduceMotion: DEFAULT_PREFERENCES.reduceMotion,
                    sidebarOpen: DEFAULT_PREFERENCES.sidebarOpen,
                  })
                }
              >
                Restore appearance defaults
              </button>
            </>
          )}
          {section === "chat" && (
            <>
              <Row title="Send a message" note="Shift+Enter always adds a new line.">
                <Choice
                  label="Send a message"
                  value={prefs.sendKey}
                  values={[
                    ["enter", "Enter"],
                    ["modifier-enter", "⌘ / Ctrl + Enter"],
                  ]}
                  onChange={(sendKey) =>
                    save({ sendKey: sendKey as AccountPreferences["sendKey"] })
                  }
                />
              </Row>
              <Row
                title="Photo edits need your approval"
                note="Plain-English edits and culling create a preview. You decide whether to apply it."
              >
                <span className="settings-fixed">
                  <Check size={15} />
                  Always on
                </span>
              </Row>
              <Row
                title="New chat keeps your shoot"
                note="Conversations are separate from photos. Starting a new chat doesn't delete your pictures or undo history."
              >
                <Check size={17} />
              </Row>
              <p className="settings-footnote">
                {account.local
                  ? "Chat messages and drafts are stored on this device."
                  : "Sent chat messages are saved to your account. Unsent drafts stay in this tab and are not uploaded."}
              </p>
              <p className="settings-footnote">
                Previous chat messages are a record, not instructions to run again. An old preview
                is never automatically applied.
              </p>
            </>
          )}
          {section === "connections" && <Connections />}
          {section === "privacy" && (
            <>
              <Row
                title="Originals stay read-only"
                note="Rejects are reversible. Applying an edit does not overwrite your original photo."
              >
                <Check size={17} />
              </Row>
              <Row
                title="Assistant data"
                note="Local commands run on this device. In a signed-in cloud workspace, unmatched messages and current shoot metadata can be sent to the hosted assistant. Gmail content is not added to the photography chat."
              >
                <Shield size={17} />
              </Row>
              <Row
                title="Browser storage"
                note="An estimate for this entire LensLabs origin, across local profiles. Not cloud usage or a subscription allowance."
              >
                <span>
                  {storage?.usage !== undefined
                    ? formatBytes(storage.usage) + " used"
                    : "Not measured"}
                </span>
              </Row>
              {storage?.quota !== undefined && (
                <p className="settings-footnote">
                  Browser-reported capacity: {formatBytes(storage.quota)}. Capacity can change.
                </p>
              )}
              <Row
                title="Protect local files from automatic cleanup"
                note={
                  storage?.persisted
                    ? "The browser granted persistent storage. Clearing site data manually can still remove local files."
                    : "Ask your browser to retain local files when storage is low. The browser decides whether to grant this."
                }
              >
                <button
                  className="settings-button"
                  disabled={storage?.persisted}
                  onClick={() => {
                    void (async () => {
                      try {
                        if (!navigator.storage?.persist)
                          throw new Error(
                            "This browser does not support persistent-storage requests.",
                          );
                        const granted = await navigator.storage.persist();
                        setNote(
                          granted
                            ? "Persistent storage granted."
                            : "The browser did not grant persistent storage. Export important shoots for backup.",
                        );
                        await measure();
                      } catch (error) {
                        setError(
                          error instanceof Error ? error.message : "Storage request failed.",
                        );
                      }
                    })();
                  }}
                >
                  {storage?.persisted ? "Protected" : "Request protection"}
                </button>
              </Row>
              <button
                className="settings-text-action"
                onClick={() => void workbench?.openTool("/projects")}
              >
                Open projects to export a backup <ArrowUpRight size={15} />
              </button>
            </>
          )}
          {section === "shortcuts" && (
            <div className="settings-shortcuts">
              {[
                ["⌘ / Ctrl + K", "Open tools"],
                ["⌘ / Ctrl + ,", "Open settings"],
                ["⌘ / Ctrl + B", "Toggle sidebar"],
                [prefs.sendKey === "enter" ? "Enter" : "⌘ / Ctrl + Enter", "Send chat message"],
                ["Shift + Enter", "New line in chat"],
                ["K", "Keep the selected photo"],
                ["X", "Soft reject"],
                ["U", "Mark undecided"],
                ["← / →", "Previous / next photo"],
                ["⌘ / Ctrl + Z", "Undo photo change"],
              ].map(([key, description]) => (
                <div key={key}>
                  <span>{description}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
              <p className="settings-footnote">
                Photo shortcuts work when the Studio pane is focused, not while typing.
              </p>
            </div>
          )}
          <div className="settings-feedback" aria-live="polite">
            {error ? (
              <p role="alert">{error}</p>
            ) : note ? (
              <p>
                <Check size={14} />
                {note}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
function Connections() {
  const gmail = useGmail();
  const workbench = useWorkbench();
  const [search, setSearch] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    void webSearchReadiness()
      .then((value) => {
        if (alive) setSearch(value.configured);
      })
      .catch(() => {
        if (alive) setNote("Search configuration could not be checked.");
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <Row
        title="Gmail"
        note={
          gmail.status.state === "connected"
            ? (gmail.status.email ?? "Connected with read-only access.")
            : gmail.configured
              ? "Read-only search. You choose the Google account and approve access."
              : "Not configured. Add the Google OAuth client ID in hosting settings to enable this connection."
        }
      >
        <button
          className="settings-button"
          disabled={!gmail.configured || !gmail.ready || gmail.status.state === "connecting"}
          onClick={() =>
            gmail.status.state === "connected" ? void gmail.disconnect() : gmail.connect()
          }
        >
          {gmail.status.state === "connected"
            ? "Disconnect"
            : gmail.status.state === "connecting"
              ? "Connecting…"
              : "Connect"}
        </button>
      </Row>
      {gmail.status.note && (
        <p className="settings-footnote" role="status">
          {gmail.status.note}
        </p>
      )}
      <Row
        title="Web search"
        note={
          search === true
            ? "Brave Search is configured. A LensLabs sign-in is required for in-app results."
            : search === false
              ? "In-app search needs the search provider configured in hosting settings. You can still open a search on the web."
              : note || "Checking configuration…"
        }
      >
        <button className="settings-button" onClick={() => void workbench?.openTool("/research")}>
          Open search <ArrowUpRight size={14} />
        </button>
      </Row>
      <Row
        title="Adobe & Lightroom"
        note="Import supported Adobe settings, export XMP, or set up the Lightroom bridge. A bridge isn't marked connected until Studio verifies it."
      >
        <button className="settings-button" onClick={() => void workbench?.openTool("/adobe")}>
          Open Adobe <ArrowUpRight size={14} />
        </button>
      </Row>
      <p className="settings-footnote">
        Gmail access lasts for this workspace session and may expire sooner. It is never stored in
        chat history or reconnected without your permission.
      </p>
    </>
  );
}
function formatBytes(value: number) {
  return value < 1_000_000
    ? Math.round(value / 1000) + " KB"
    : value < 1_000_000_000
      ? (value / 1_000_000).toFixed(1) + " MB"
      : (value / 1_000_000_000).toFixed(2) + " GB";
}
