import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { useAccount } from "./AccountProvider";
import { profileInputSchema } from "@/lib/account-profile";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";

/** Drafts survive tabbing between fields; a failed save never clears typed information. */
export function ProfileForm({ onboarding = false }: { onboarding?: boolean }) {
  const account = useAccount()!;
  const [name, setName] = useState(account.name);
  const [workspaceName, setWorkspaceName] = useState(account.workspaceName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const changed = name.trim() !== account.name || workspaceName.trim() !== account.workspaceName;
  useToolLeaveGuard(
    saving
      ? "Your profile is still saving."
      : !onboarding && changed
        ? "Your profile has unsaved changes."
        : null,
  );
  return (
    <form
      className="settings-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending.current) return;
        const result = profileInputSchema.safeParse({ name, workspaceName });
        setSaved(false);
        if (!result.success) {
          setError(result.error.issues[0]?.message ?? "Check your profile details.");
          return;
        }
        pending.current = true;
        setSaving(true);
        setError("");
        void account
          .saveProfile(result.data)
          .then(() => {
            setName(result.data.name);
            setWorkspaceName(result.data.workspaceName);
            setSaved(true);
          })
          .catch((reason: unknown) =>
            setError(reason instanceof Error ? reason.message : "Could not save. Try again."),
          )
          .finally(() => {
            pending.current = false;
            setSaving(false);
          });
      }}
    >
      <label className="settings-label" htmlFor="profile-display-name">
        Your name
      </label>
      <input
        id="profile-display-name"
        autoComplete="name"
        placeholder="Vincent van Gogh"
        maxLength={80}
        required
        value={name}
        disabled={saving}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
      />
      <label className="settings-label" htmlFor="profile-workspace-name">
        Workspace name
      </label>
      <input
        id="profile-workspace-name"
        autoComplete="organization"
        placeholder="Your studio"
        maxLength={80}
        required
        value={workspaceName}
        disabled={saving}
        onChange={(event) => {
          setWorkspaceName(event.target.value);
          setSaved(false);
        }}
      />
      <p className="settings-footnote">
        Your personal workspace. Renaming it keeps every shoot and conversation.
      </p>
      <div className="settings-form-actions">
        <button
          className="settings-button primary"
          type="submit"
          disabled={saving || (!onboarding && !changed)}
        >
          {saving ? "Saving…" : onboarding ? "Open workspace →" : "Save changes"}
        </button>
        {!onboarding && changed && (
          <button
            className="settings-button"
            type="button"
            disabled={saving}
            onClick={() => {
              setName(account.name);
              setWorkspaceName(account.workspaceName);
              setError("");
              setSaved(false);
            }}
          >
            Cancel
          </button>
        )}
        <span role="status">
          {saved && (
            <>
              <Check size={14} /> Saved to your account
            </>
          )}
        </span>
      </div>
      {error && (
        <p className="settings-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
