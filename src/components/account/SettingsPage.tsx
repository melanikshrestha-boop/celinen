import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Shield } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { ProfileForm } from "@/components/account/ProfileForm";
import { useWorkbench } from "@/components/workbench/context";
import { useGmail } from "@/components/workbench/GmailConnection";
import {
  accountInitials,
  DEFAULT_PREFERENCES,
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
import { SettingsWorkspace } from "@/components/account/SettingsWorkspace";
import { SettingsRow as Row } from "./SettingsPrimitives";

type Section = "account" | "appearance" | "chat" | "connections" | "privacy" | "shortcuts";
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

export function Settings() {
  return (
    <SettingsWorkspace
      renderExisting={(section) => <SettingsDetails key={section} section={section} />}
    />
  );
}
function SettingsDetails({ section }: { section: Section }) {
  const account = useAccount();
  const workbench = useWorkbench();
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
    persisted: boolean;
  } | null>(null);
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
  const shortcuts = [
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
  ].filter((entry) => entry.join(" ").toLowerCase().includes(shortcutQuery.trim().toLowerCase()));
  return (
    <section className="settings-existing">
      <div className="settings-detail">
        {section === "account" && (
          <div>
            <div className="settings-profile">
              <span className="account-avatar large">
                {account.avatar ? (
                  <img src={account.avatar} alt="" />
                ) : (
                  accountInitials(account.name)
                )}
              </span>
              <div>
                <strong>{account.name}</strong>
                <p>{account.local ? "Local profile · this device only" : account.user?.email}</p>
              </div>
            </div>
            <ProfileForm key={account.scope} />
            <Row
              title="Stay signed in"
              note={
                account.local
                  ? "This development profile opens without authentication. It cannot access cloud accounts."
                  : "Your session restores automatically. Log out on shared computers."
              }
            >
              <span className="settings-fixed">
                <Check size={15} /> {account.local ? "Development only" : "Enabled"}
              </span>
            </Row>
            <Row title="Sign-in method" note="Use your original method when signing in again.">
              <span>
                {account.local
                  ? "No sign-in"
                  : account.user?.app_metadata?.["provider"] === "google"
                    ? "Google"
                    : "Email"}
              </span>
            </Row>
            <p className="settings-footnote">
              {account.local
                ? "This is a local development identity, not a verified account or paid plan."
                : "Your sign-in email is shown above and cannot be changed here. Session expiry or clearing browser data may require signing in again."}
            </p>
          </div>
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
                onChange={(sendKey) => save({ sendKey: sendKey as AccountPreferences["sendKey"] })}
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
              title="New chats start fresh"
              note="Previous photos stay in Recent Shoots. Open a shoot to continue its conversations and edits."
            >
              <Check size={17} />
            </Row>
            <p className="settings-footnote">
              {account.local
                ? "Chat messages and drafts are stored on this device."
                : "Sent chat messages are saved to your account. Unsent drafts stay in this tab and are not uploaded."}
            </p>
            <p className="settings-footnote">
              Previous chat messages are a record, not instructions to run again. An old preview is
              never automatically applied.
            </p>
          </>
        )}
        {section === "connections" && <Connections />}
        {section === "privacy" && (
          <>
            <Row
              title="Learn from your photos and edits"
              note="On: Celinen remembers looks you save (snapshots and presets) so the tool gets closer to your eye. Original files stay read-only and are not stored in that log. This is your workspace only — not a shared model for other photographers. Off: no new samples, and the log is deleted."
            >
              <Switch
                aria-label="Learn from your photos and edits"
                checked={prefs.learnFromYourWork}
                onCheckedChange={(on) => {
                  save({ learnFromYourWork: on });
                  if (!on) {
                    void import("@/lib/personal-style").then((m) => m.clearPersonalStyle());
                  }
                }}
              />
            </Row>
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
              note="An estimate for this entire Celinen origin, across local profiles. Not cloud usage or a subscription allowance."
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
                      setError(error instanceof Error ? error.message : "Storage request failed.");
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
            <input
              className="settings-shortcut-search"
              aria-label="Search keyboard shortcuts"
              type="search"
              placeholder="Find a shortcut…"
              value={shortcutQuery}
              onChange={(event) => setShortcutQuery(event.target.value)}
            />
            {shortcuts.map(([key, description]) => (
              <div key={key}>
                <span>{description}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            {shortcuts.length === 0 && (
              <p role="status" className="settings-footnote">
                No shortcuts match “{shortcutQuery}”.
              </p>
            )}
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
    </section>
  );
}
function Connections() {
  const account = useAccount();
  const gmail = useGmail();
  const workbench = useWorkbench();
  const [search, setSearch] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (account?.local) {
      setSearch(false);
      return;
    }
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
  }, [account?.local]);
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
            ? "Brave Search is configured. A Celinen sign-in is required for in-app results."
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
      <Row
        title="Instagram, Stories & portfolio"
        note="Connect Instagram and Facebook Pages. Prepare feed posts and Stories, then review before publishing."
      >
        <button className="settings-button" onClick={() => void workbench?.openTool("/publish")}>
          Open publishing <ArrowUpRight size={14} />
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
