import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Context,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { SESSION_RESTORE_DEADLINE_MS, verifiedSessionReceiver } from "@/lib/account-access";
import { profileInputSchema, readAccountProfile, type ProfileInput } from "@/lib/account-profile";
import { avatarStorageKey, readLocalAvatar, writeLocalAvatar } from "@/lib/account-avatar";
import type { PhotographerWorkRole } from "@/lib/photographer-work-roles";
import { applyAppearance } from "@/lib/appearance";
import { disconnectProductAnalytics } from "@/lib/product-lifecycle";
import {
  accountName,
  DEFAULT_PREFERENCES,
  displayNameSchema,
  observeSession,
  preferenceKey,
  mergePreferencePatch,
  readPreferences,
  type AccountPreferences,
} from "@/lib/account-preferences";
import { rememberSignedIn } from "@/lib/signed-in-hint";
type Account = {
  status: "loading" | "in" | "out";
  scope: string | null;
  user: User | null;
  local: boolean;
  name: string;
  workspaceName: string;
  biography?: string | undefined;
  avatar?: string | undefined;
  specialties?: string[] | undefined;
  customSpecialty?: string | undefined;
  workRole?: PhotographerWorkRole | undefined;
  setupComplete: boolean;
  error: string | null;
  preferences: AccountPreferences;
  saveName: (name: string) => Promise<void>;
  saveProfile: (profile: ProfileInput) => Promise<void>;
  saveAvatar: (avatar: string) => Promise<void>;
  savePreferences: (patch: Partial<AccountPreferences>) => void;
  signOut: () => Promise<boolean>;
  registerLeaveGuard: (guard: () => Promise<boolean>) => () => void;
};
const AccountContext =
  (import.meta.hot?.data["accountContext"] as Context<Account | null> | undefined) ??
  createContext<Account | null>(null);
if (import.meta.hot) import.meta.hot.data["accountContext"] = AccountContext;
// eslint-disable-next-line react-refresh/only-export-components
export const useAccount = () => useContext(AccountContext);
export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Account["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<AccountPreferences>(DEFAULT_PREFERENCES);
  const [localAvatar, setLocalAvatar] = useState<string | undefined>(undefined);
  const guards = useRef(new Set<() => Promise<boolean>>());
  const signingOut = useRef(false);
  const identityEpoch = useRef(0);
  const profileEpoch = useRef(0);
  const confirmedProfile = useRef<{ owner: string; metadata: Record<string, unknown> } | null>(
    null,
  );
  const scope = status === "in" ? (user?.id ?? null) : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    const restoreFailed = () => {
      clearTimeout(deadline);
      receiver.cancel();
      setUser(null);
      setStatus("out");
      rememberSignedIn(false);
      setError("Your saved sign-in could not be restored. Sign in again to continue.");
    };
    // Auth that never answers (stalled storage lock, dead network) still ends signed out,
    // so private pages redirect to Sign In instead of holding their loader forever.
    const deadline = setTimeout(restoreFailed, SESSION_RESTORE_DEADLINE_MS);
    const receiver = verifiedSessionReceiver(
      async (token) => {
        const startedAt = profileEpoch.current;
        const { data, error } = await supabase.auth.getUser(token);
        if (error) throw error;
        // A verification begun before a completed profile save must not reopen setup
        // (and unmount the shoot) with its older metadata. Identity still comes from Auth.
        if (
          data.user &&
          startedAt !== profileEpoch.current &&
          confirmedProfile.current?.owner === data.user.id
        )
          return {
            ...data.user,
            user_metadata: { ...data.user.user_metadata, ...confirmedProfile.current.metadata },
          };
        return data.user;
      },
      (verified) => {
        clearTimeout(deadline);
        // Fence pending analytics before React installs a new verified account.
        disconnectProductAnalytics(verified?.id);
        if (confirmedProfile.current?.owner !== verified?.id) confirmedProfile.current = null;
        identityEpoch.current++;
        setUser(verified);
        setStatus(verified ? "in" : "out");
        rememberSignedIn(Boolean(verified));
        setError(null);
      },
      () => setError("Sign in with a verified email to open your workspace."),
    );
    const stop = observeSession<Session | null>(
      (receive) => {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => receive(session));
        return () => data.subscription.unsubscribe();
      },
      async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
      },
      receiver.receive,
      restoreFailed,
    );
    return () => {
      clearTimeout(deadline);
      receiver.cancel();
      stop();
    };
  }, []);
  useEffect(() => {
    if (!scope) return;
    let alive = true;
    const epoch = identityEpoch.current,
      profile = profileEpoch.current;
    // Cached SDK sessions remember sign-in; the profile itself is refreshed from Auth.
    void supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (
          !error &&
          alive &&
          scopeRef.current === scope &&
          identityEpoch.current === epoch &&
          profileEpoch.current === profile &&
          data.user?.id === scope
        )
          setUser(data.user);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [scope]);
  useEffect(() => {
    if (!scope) {
      setPreferences(DEFAULT_PREFERENCES);
      return;
    }
    const read = () => {
      try {
        setPreferences(readPreferences(localStorage.getItem(preferenceKey(scope))));
      } catch {
        setError("Preferences could not be read on this browser.");
      }
    };
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === preferenceKey(scope) || event.key === null) read();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [scope]);
  useEffect(() => {
    if (!scope) {
      setLocalAvatar(undefined);
      return;
    }
    const read = () => setLocalAvatar(readLocalAvatar(scope));
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === avatarStorageKey(scope)) read();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [scope]);
  useEffect(() => {
    if (!scope) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      applyAppearance(preferences, media.matches);
      document.documentElement.dataset["reduceMotion"] = String(preferences.reduceMotion);
      document.documentElement.dataset["chatText"] = preferences.textSize;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [scope, preferences]);
  const registerLeaveGuard = useCallback((guard: () => Promise<boolean>) => {
    guards.current.add(guard);
    return () => {
      guards.current.delete(guard);
    };
  }, []);
  const savePreferences = useCallback(
    (patch: Partial<AccountPreferences>) => {
      if (!scope || scopeRef.current !== scope) throw new Error("Open your workspace first.");
      const next = mergePreferencePatch(
        preferences,
        readPreferences(localStorage.getItem(preferenceKey(scope))),
        patch,
      );
      localStorage.setItem(preferenceKey(scope), JSON.stringify(next));
      setPreferences(next);
    },
    [scope, preferences],
  );
  const saveName = useCallback(
    async (value: string) => {
      const name = displayNameSchema.parse(value);
      if (!scope) throw new Error("Sign in first.");
      const epoch = identityEpoch.current;
      profileEpoch.current++;
      const { saveAccountName } = await import("@/lib/account.functions");
      const saved = await saveAccountName({ data: { expectedOwner: scope, name } });
      if (scopeRef.current === scope && identityEpoch.current === epoch)
        setUser((user) =>
          user?.id === scope
            ? {
                ...user,
                user_metadata: {
                  ...user.user_metadata,
                  display_name: saved.name,
                  full_name: saved.name,
                },
              }
            : user,
        );
    },
    [scope],
  );
  const signOut = useCallback(async () => {
    if (signingOut.current) return false;
    signingOut.current = true;
    const startingScope = scopeRef.current,
      epoch = identityEpoch.current;
    setError(null);
    try {
      for (const guard of guards.current) if (!(await guard())) return false;
      if (scopeRef.current !== startingScope || identityEpoch.current !== epoch)
        throw new Error("Your account changed while saving. Check the profile and try again.");
      {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id !== startingScope || identityEpoch.current !== epoch)
          throw new Error("Your account changed. Check the profile before signing out.");
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      setUser(null);
      identityEpoch.current++;
      setStatus("out");
      rememberSignedIn(false);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-out failed. Try again.");
      return false;
    } finally {
      signingOut.current = false;
    }
  }, []);
  const saveProfile = useCallback(
    async (input: ProfileInput) => {
      const profile = profileInputSchema.parse(input);
      if (!scope) throw new Error("Sign in first.");
      const epoch = identityEpoch.current;
      const operation = ++profileEpoch.current;
      const { saveAccountProfile } = await import("@/lib/account.functions");
      const metadata = await saveAccountProfile({ data: { ...profile, expectedOwner: scope } });
      if (
        scopeRef.current !== scope ||
        identityEpoch.current !== epoch ||
        profileEpoch.current !== operation
      )
        throw new Error(
          "Your account changed while saving. Reopen settings to check your profile.",
        );
      confirmedProfile.current = { owner: scope, metadata };
      profileEpoch.current++;
      if (profile.avatar !== undefined) {
        writeLocalAvatar(scope, profile.avatar);
        setLocalAvatar(profile.avatar);
      }
      setUser((current) =>
        current?.id === scope
          ? { ...current, user_metadata: { ...current.user_metadata, ...metadata } }
          : current,
      );
    },
    [scope],
  );
  const saveAvatar = useCallback(
    async (avatar: string) => {
      if (!scope) throw new Error("Sign in first.");
      writeLocalAvatar(scope, avatar);
      setLocalAvatar(avatar);
    },
    [scope],
  );
  const value = useMemo<Account>(
    () => ({
      status,
      scope,
      user,
      local: false,
      name: accountName(user?.user_metadata, user?.email),
      ...readAccountProfile(user?.user_metadata),
      avatar:
        localAvatar !== undefined
          ? localAvatar || undefined
          : readAccountProfile(user?.user_metadata).avatar,
      error,
      preferences,
      saveName,
      saveProfile,
      saveAvatar,
      savePreferences,
      signOut,
      registerLeaveGuard,
    }),
    [
      status,
      scope,
      user,
      error,
      preferences,
      localAvatar,
      saveName,
      saveProfile,
      saveAvatar,
      savePreferences,
      signOut,
      registerLeaveGuard,
    ],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
