import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PREFERENCES,
  displayNameSchema,
  preferenceKey,
  mergePreferencePatch,
  readPreferences,
} from "../lib/account-preferences";
import { profileInputSchema, type ProfileInput } from "../lib/account-profile";
import { avatarStorageKey, readLocalAvatar, writeLocalAvatar } from "../lib/account-avatar";
import { applyAppearance } from "../lib/appearance";
import type { useAccount as realUseAccount } from "../components/account/AccountProvider";

type Account = NonNullable<ReturnType<typeof realUseAccount>>;
// The separate 127.0.0.1:8085 origin isolates this device-local repository from
// both localhost:8080 and the published site's data. This is not an account ID.
const scope = "device-local";
const profileKey = "lenslabs.development-lab.profile.v1";
const initialProfile = {
  name: "Celine Nova",
  workspaceName: "Development workspace",
};
const AccountContext = createContext<Account | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useAccount = () => useContext(AccountContext);

const labOnboardKey = "lenslabs.development-lab.onboard";
function labOnboardPreview() {
  if (typeof window === "undefined") return false;
  if (/\bonboard\b/.test(`${window.location.search}${window.location.hash}`)) {
    sessionStorage.setItem(labOnboardKey, "1");
    return true;
  }
  return sessionStorage.getItem(labOnboardKey) === "1";
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<ProfileInput>(initialProfile);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [error, setError] = useState<string | null>(null);
  const [onboard, setOnboard] = useState(labOnboardPreview);
  const guards = useRef(new Set<() => Promise<boolean>>());
  const closing = useRef(false);
  useEffect(() => {
    const read = () => {
      try {
        const parsed = profileInputSchema.safeParse(
          JSON.parse(localStorage.getItem(profileKey) ?? "null"),
        );
        const parsedProfile =
          parsed.success && parsed.data.name !== "Development workspace"
            ? parsed.data
            : initialProfile;
        const overlay = readLocalAvatar(scope);
        setProfile(
          overlay !== undefined
            ? { ...parsedProfile, avatar: overlay || undefined }
            : parsedProfile,
        );
        setPreferences(readPreferences(localStorage.getItem(preferenceKey(scope))));
        setError(null);
      } catch {
        setError("Local preferences could not be read. Your photos have not been changed.");
      }
    };
    read();
    setReady(true);
    const changed = (event: StorageEvent) => {
      if (!event.key || [profileKey, preferenceKey(scope), avatarStorageKey(scope)].includes(event.key))
        read();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearance(preferences, media.matches);
    apply();
    media.addEventListener("change", apply);
    document.documentElement.dataset["reduceMotion"] = String(preferences.reduceMotion);
    document.documentElement.dataset["chatText"] = preferences.textSize;
    return () => media.removeEventListener("change", apply);
  }, [preferences]);
  const account: Account = {
    status: ready ? "in" : "loading",
    scope: ready ? scope : null,
    user: null,
    local: true,
    setupComplete: !onboard,
    error,
    ...profile,
    preferences,
    saveName: async (value) => {
      const next = { ...profile, name: displayNameSchema.parse(value) };
      localStorage.setItem(profileKey, JSON.stringify(next));
      setProfile(next);
    },
    saveProfile: async (value) => {
      const next = profileInputSchema.parse(value);
      localStorage.setItem(profileKey, JSON.stringify(next));
      if (next.avatar !== undefined) writeLocalAvatar(scope, next.avatar);
      setProfile(next);
      sessionStorage.removeItem(labOnboardKey);
      setOnboard(false);
    },
    saveAvatar: async (avatar) => {
      const next = profileInputSchema.parse({ ...profile, avatar });
      localStorage.setItem(profileKey, JSON.stringify(next));
      writeLocalAvatar(scope, avatar);
      setProfile(next);
    },
    savePreferences: (patch) => {
      const next = mergePreferencePatch(
        preferences,
        readPreferences(localStorage.getItem(preferenceKey(scope))),
        patch,
      );
      localStorage.setItem(preferenceKey(scope), JSON.stringify(next));
      setPreferences(next);
    },
    registerLeaveGuard: (guard) => {
      guards.current.add(guard);
      return () => {
        guards.current.delete(guard);
      };
    },
    signOut: async () => {
      if (closing.current) return false;
      closing.current = true;
      try {
        for (const guard of guards.current) if (!(await guard())) return false;
        window.location.assign("http://localhost:8080/");
        return true;
      } catch {
        setError("Your work could not be saved. Keep this tab open and try again.");
        return false;
      } finally {
        closing.current = false;
      }
    },
  };
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}
