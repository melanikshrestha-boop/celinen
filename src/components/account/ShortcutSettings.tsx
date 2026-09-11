import { useState } from "react";
import { Trash2, Pencil } from "lucide-react";
import { useAccount } from "./AccountProvider";
import {
  SettingsRow as Row,
  SettingsGroup as Group,
  SettingsChoice as Choice,
} from "./SettingsPrimitives";
import {
  DEFAULT_SHORTCUTS,
  GLOBAL_KEYS,
  MEDIA_KEYS,
  SHORTCUTS,
  shortcutsSchema,
  shortcutLabel,
  recordedShortcut,
  type ShortcutId,
} from "@/lib/shortcuts";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export function ShortcutSettings() {
  const account = useAccount()!;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [reset, setReset] = useState(false);
  const bindings = account.preferences.shortcuts;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const save = (id: ShortcutId, value: string) => {
    const conflict =
      value && SHORTCUTS.find((action) => action.id !== id && bindings[action.id] === value);
    if (conflict) {
      setError(`Already assigned to ${conflict.label}.`);
      return;
    }
    const candidate = shortcutsSchema.safeParse({ ...bindings, [id]: value });
    if (!candidate.success) {
      setError(candidate.error.issues[0]?.message ?? "Unsupported key combination.");
      return;
    }
    try {
      account.savePreferences({ shortcuts: candidate.data });
      setError("");
      setEditing(null);
      setNote("Shortcut saved on this browser.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save shortcut.");
    }
  };
  const results = SHORTCUTS.filter((action) =>
    `${action.label} ${action.category} ${shortcutLabel(bindings[action.id], mac)} ${bindings[action.id]}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  return (
    <>
      <input
        className="settings-shortcut-search"
        aria-label="Search keyboard shortcuts"
        type="search"
        placeholder="Find a command or key combination…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Group title="Customizable commands">
        {results.map((action) => (
          <Row key={action.id} title={action.label} note={action.category}>
            <div className="settings-inline-actions">
              <button
                className="settings-button"
                aria-label={`Edit ${action.label}`}
                onClick={() => {
                  setEditing(action.id);
                  setError("");
                  setNote("");
                }}
              >
                <kbd>{shortcutLabel(bindings[action.id], mac)}</kbd>
                <Pencil size={13} />
              </button>
              <button
                className="settings-button"
                aria-label={`Remove ${action.label} shortcut`}
                disabled={!bindings[action.id]}
                onClick={() => save(action.id, "")}
              >
                <Trash2 size={14} />
              </button>
              <button
                className="settings-button"
                aria-label={`Reset ${action.label}`}
                disabled={bindings[action.id] === action.default}
                onClick={() => save(action.id, action.default)}
              >
                Reset
              </button>
            </div>
          </Row>
        ))}
        {!results.length && (
          <p role="status" className="settings-footnote">
            No matching commands.
          </p>
        )}
      </Group>
      <Group title="Fixed navigation">
        <Row
          title="Focus browser address bar"
          note="Owned by your browser, not reassignable by a website."
        >
          <kbd>{mac ? "⌘" : "Ctrl"} + L</kbd>
        </Row>
        <Row title="Previous or next photo" note="Studio focus only">
          <kbd>← / →</kbd>
        </Row>
        <Row title="Undo photo change" note="Studio focus only">
          <kbd>{mac ? "⌘" : "Ctrl"} + Z</kbd>
        </Row>
        <Row title="Show or hide sidebar">
          <kbd>{mac ? "⌘" : "Ctrl"} + B</kbd>
        </Row>
        <Row title="New line in chat">
          <kbd>Shift + Enter</kbd>
        </Row>
      </Group>
      <p className="settings-footnote">
        Workspace and Studio commands do not run while typing. Native browser shortcuts are not
        reassigned. New chat uses Alt + Shift + C because ⌘/Ctrl + N opens a browser window.
        Temporary chat is excluded from history, but assistant requests still use your chosen
        local/cloud engine. Send behavior is in General.
      </p>
      <button className="settings-button" onClick={() => setReset(true)}>
        Reset all shortcuts…
      </button>
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
      <AlertDialog
        open={editing !== null || reset}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setReset(false);
            setError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reset
                ? "Reset all shortcuts?"
                : `Edit ${SHORTCUTS.find((entry) => entry.id === editing)?.label}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reset
                ? "Restore the LensLabs bindings. Other preferences remain unchanged."
                : "Choose an available combination, or focus the recorder and press it. Conflicting bindings are rejected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {editing && (
            <>
              <Choice
                label="Key combination"
                value={bindings[editing] || "none"}
                options={(SHORTCUTS.find((entry) => entry.id === editing)?.category === "Studio"
                  ? MEDIA_KEYS
                  : GLOBAL_KEYS
                ).map((key) => [key || "none", shortcutLabel(key, mac)] as const)}
                change={(value) => save(editing, value === "none" ? "" : value)}
              />
              <button
                className="settings-button"
                onKeyDown={(event) => {
                  if (event.key === "Tab" || event.key === "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
                  save(editing, recordedShortcut(event.nativeEvent));
                }}
              >
                Focus here and press a combination
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {reset && (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  try {
                    account.savePreferences({ shortcuts: DEFAULT_SHORTCUTS });
                    setReset(false);
                    setNote("Default shortcuts restored.");
                    setError("");
                  } catch {
                    setError("Could not save shortcuts. Try again.");
                  }
                }}
              >
                Reset shortcuts
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
