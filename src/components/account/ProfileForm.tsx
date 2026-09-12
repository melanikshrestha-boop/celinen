import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useAccount } from "./AccountProvider";
import { profileInputSchema } from "@/lib/account-profile";
import {
  profileSeedFromWorkRole,
  type PhotographerWorkRole,
} from "@/lib/photographer-work-roles";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { AvatarEditor, type AvatarEditorHandle } from "./AvatarEditor";
import { PhotographySpecialtyPicker } from "./PhotographySpecialtyPicker";

/** Drafts survive tabbing between fields; a failed save never clears typed information. */
export function ProfileForm({
  onboarding = false,
  workRole,
}: {
  onboarding?: boolean;
  workRole?: PhotographerWorkRole;
}) {
  const account = useAccount()!;
  const seed = workRole ? profileSeedFromWorkRole(workRole) : null;
  const [name, setName] = useState(account.name);
  const [workspaceName, setWorkspaceName] = useState(account.workspaceName);
  const [biography, setBiography] = useState(account.biography ?? "");
  const [avatar, setAvatar] = useState(account.avatar ?? "");
  const [specialties, setSpecialties] = useState(seed?.specialties ?? account.specialties ?? []);
  const [customSpecialty, setCustomSpecialty] = useState(
    seed?.customSpecialty ?? account.customSpecialty ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const pending = useRef(false);
  const editor = useRef<AvatarEditorHandle>(null);
  const currentProfile = JSON.stringify({
    name: account.name,
    workspaceName: account.workspaceName,
    biography: account.biography ?? "",
    avatar: account.avatar ?? "",
    specialties: account.specialties ?? [],
    customSpecialty: account.customSpecialty ?? "",
  });
  const baseline = useRef(currentProfile);
  const changed =
    cropOpen ||
    JSON.stringify({
      name: name.trim(),
      workspaceName: workspaceName.trim(),
      biography: biography.trim(),
      avatar,
      specialties,
      customSpecialty: customSpecialty.trim(),
    }) !== baseline.current;
  useEffect(() => {
    if (!changed && !saving) {
      const value = JSON.parse(currentProfile) as {
        name: string;
        workspaceName: string;
        biography: string;
        avatar: string;
        specialties: string[];
        customSpecialty: string;
      };
      baseline.current = currentProfile;
      setName(value.name);
      setWorkspaceName(value.workspaceName);
      setBiography(value.biography);
      setAvatar(value.avatar);
      setSpecialties(value.specialties);
      setCustomSpecialty(value.customSpecialty);
    }
  }, [currentProfile, changed, saving]);
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
      id="setting-profile-details"
      data-setting-id="setting-profile-details"
      tabIndex={-1}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending.current) return;
        if (baseline.current !== currentProfile) {
          setError(
            "Your profile changed in another tab. Cancel to load the current values before saving.",
          );
          return;
        }
        const cropped = editor.current?.applyPending();
        const nextAvatar = cropped ?? avatar;
        if (cropped) setAvatar(cropped);
        const result = profileInputSchema.safeParse({
          name,
          workspaceName,
          biography,
          avatar: nextAvatar,
          specialties,
          customSpecialty,
          ...(workRole ? { workRole } : {}),
        });
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
            baseline.current = JSON.stringify({
              name: result.data.name,
              workspaceName: result.data.workspaceName,
              biography: result.data.biography ?? "",
              avatar: result.data.avatar ?? "",
              specialties: result.data.specialties ?? [],
              customSpecialty: result.data.customSpecialty ?? "",
            });
            setName(result.data.name);
            setWorkspaceName(result.data.workspaceName);
            setBiography(result.data.biography ?? "");
            setAvatar(result.data.avatar ?? "");
            setSpecialties(result.data.specialties ?? []);
            setCustomSpecialty(result.data.customSpecialty ?? "");
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
      {!onboarding && (
        <AvatarEditor
          ref={editor}
          value={avatar}
          name={name}
          disabled={saving}
          onPendingChange={setCropOpen}
          onChange={(value) => {
            setAvatar(value);
            setSaved(false);
          }}
        />
      )}
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
      {!(onboarding && workRole) && (
        <>
          <label
            className="settings-label"
            id="profile-specialties-label"
            htmlFor="profile-specialties"
          >
            What kind of photographer are you?
          </label>
          <PhotographySpecialtyPicker
            value={specialties}
            disabled={saving}
            onChange={(value) => {
              setSpecialties(value);
              setSaved(false);
            }}
          />
          <p className="settings-footnote profile-specialty-hint" id="profile-specialties-hint">
            Choose up to five, or add your own.
          </p>
        </>
      )}
      {specialties.includes("other") && (
        <>
          <label className="settings-label" htmlFor="profile-custom-specialty">
            Your specialty
          </label>
          <input
            id="profile-custom-specialty"
            placeholder="Your kind of photography"
            maxLength={80}
            value={customSpecialty}
            disabled={saving}
            required
            onChange={(event) => {
              setCustomSpecialty(event.target.value);
              setSaved(false);
            }}
          />
        </>
      )}
      {!onboarding && (
        <>
          <label className="settings-label" htmlFor="profile-biography">
            Biography (optional)
          </label>
          <textarea
            id="profile-biography"
            maxLength={500}
            rows={3}
            value={biography}
            disabled={saving}
            onChange={(e) => {
              setBiography(e.target.value);
              setSaved(false);
            }}
          />
          <p className="settings-footnote">Private profile · {biography.length}/500</p>
        </>
      )}
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
              editor.current?.discardPending();
              baseline.current = currentProfile;
              setName(account.name);
              setWorkspaceName(account.workspaceName);
              setBiography(account.biography ?? "");
              setAvatar(account.avatar ?? "");
              setSpecialties(account.specialties ?? []);
              setCustomSpecialty(account.customSpecialty ?? "");
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
              <Check size={14} /> {account.local ? "Saved on this device" : "Saved to your account"}
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
