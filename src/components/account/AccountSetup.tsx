import { useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { PRODUCT_NAME } from "@/lib/product";
import {
  PHOTOGRAPHER_WORK_ROLES,
  type PhotographerWorkRole,
} from "@/lib/photographer-work-roles";
import {
  memoryFromOnboarding,
  saveAssistantMemory,
  type OnboardingTaste,
} from "@/lib/assistant/memory";
import type { AccountPreferences } from "@/lib/account-preferences";
import { useAccount } from "./AccountProvider";
import { ProfileForm } from "./ProfileForm";
import "./account.css";
import "./auth-screen.css";
import "./account-setup.css";

type SetupAccount = {
  scope: string;
  user?: { email?: string | null } | null;
  error?: string | null;
  signOut: () => void | Promise<unknown>;
  savePreferences?: (patch: Partial<AccountPreferences>) => void;
};

type SetupStep = "who" | "look" | "profile";
type ThemeChoice = "light" | "dark" | "system";

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const CULLS: { id: OnboardingTaste["cull"]; label: string }[] = [
  { id: "peak", label: "Peak action" },
  { id: "face", label: "Face" },
  { id: "sharp", label: "Sharpness" },
];

const SKINS: { id: OnboardingTaste["skin"]; label: string }[] = [
  { id: "natural", label: "Natural skin" },
  { id: "smoother", label: "Smoother" },
];

/** Only mounted after verified authentication, before any private shoot is loaded. */
export function AccountSetup() {
  const account = useAccount()!;
  const [workRole, setWorkRole] = useState<PhotographerWorkRole | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  const [cull, setCull] = useState<OnboardingTaste["cull"]>("peak");
  const [skin, setSkin] = useState<OnboardingTaste["skin"]>("natural");
  const [step, setStep] = useState<SetupStep>("who");
  return (
    <AccountSetupView
      account={account}
      workRole={workRole}
      theme={theme}
      cull={cull}
      skin={skin}
      step={step}
      onPick={setWorkRole}
      onTheme={setTheme}
      onCull={setCull}
      onSkin={setSkin}
      onContinue={() => {
        if (workRole) setStep("look");
      }}
      onLookContinue={() => {
        if (!workRole) return;
        try {
          account.savePreferences?.({ theme });
          saveAssistantMemory(memoryFromOnboarding(account.scope, workRole, { cull, skin }));
        } catch {
          /* profile save still completes setup */
        }
        setStep("profile");
      }}
      onBack={() => setStep(step === "profile" ? "look" : "who")}
    />
  );
}

export function AccountSetupView({
  account,
  workRole,
  theme = "dark",
  cull = "peak",
  skin = "natural",
  step,
  onPick,
  onTheme,
  onCull,
  onSkin,
  onContinue,
  onLookContinue,
  onBack,
}: {
  account: SetupAccount;
  workRole: PhotographerWorkRole | null;
  theme?: ThemeChoice;
  cull?: OnboardingTaste["cull"];
  skin?: OnboardingTaste["skin"];
  step: SetupStep;
  onPick: (role: PhotographerWorkRole) => void;
  onTheme?: (theme: ThemeChoice) => void;
  onCull?: (cull: OnboardingTaste["cull"]) => void;
  onSkin?: (skin: OnboardingTaste["skin"]) => void;
  onContinue: () => void;
  onLookContinue?: () => void;
  onBack: () => void;
}) {
  const asking = step === "who";
  const looking = step === "look";
  const title = asking ? "Who are you?" : looking ? "Customize" : "Make yourself at home.";
  return (
    <main className="auth-screen account-setup">
      <div className="auth-scene">
        <img
          className="auth-scene-image"
          src="/images/celinen-open-sky.webp"
          alt=""
          aria-hidden="true"
          fetchPriority="high"
        />
        <a href="/" className="auth-brand" aria-label={`${PRODUCT_NAME} home`}>
          <LogoMark size={32} /> <span>{PRODUCT_NAME}</span>
        </a>
        <div className="auth-scene-copy">
          <p>Your kind of photography.</p>
          <span className="auth-scene-note">A little space to make it yours.</span>
        </div>
      </div>
      <section className="auth-panel account-setup-content" aria-labelledby="account-setup-title">
        <header className="auth-heading">
          <h1 id="account-setup-title">{title}</h1>
          {account.user?.email ? (
            <p className="account-setup-email">
              Signed in as <span>{account.user.email}</span>
            </p>
          ) : null}
        </header>
        {asking ? (
          <>
            <div
              role="radiogroup"
              aria-labelledby="account-setup-title"
              className="account-setup-roles"
            >
              {PHOTOGRAPHER_WORK_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  role="radio"
                  aria-checked={workRole === role.id}
                  className="account-setup-role"
                  onClick={() => onPick(role.id)}
                >
                  {role.label}
                  <span className="account-setup-role-mark" aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="settings-form-actions">
              <button
                className="settings-button primary"
                type="button"
                disabled={!workRole}
                onClick={onContinue}
              >
                Continue
              </button>
            </div>
          </>
        ) : looking ? (
          <>
            <p className="account-setup-label" id="account-setup-theme">
              Theme
            </p>
            <div
              role="radiogroup"
              aria-labelledby="account-setup-theme"
              className="account-setup-themes"
            >
              {THEMES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === item.id}
                  className={`account-setup-theme is-${item.id}`}
                  onClick={() => onTheme?.(item.id)}
                >
                  <span className="account-setup-theme-preview" aria-hidden="true" />
                  <span className="account-setup-theme-name">{item.label}</span>
                </button>
              ))}
            </div>
            <p className="account-setup-label" id="account-setup-cull">
              What wins a cull
            </p>
            <div
              role="radiogroup"
              aria-labelledby="account-setup-cull"
              className="account-setup-roles"
            >
              {CULLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={cull === item.id}
                  className="account-setup-role"
                  onClick={() => onCull?.(item.id)}
                >
                  {item.label}
                  <span className="account-setup-role-mark" aria-hidden="true" />
                </button>
              ))}
            </div>
            <p className="account-setup-label" id="account-setup-skin">
              Skin
            </p>
            <div
              role="radiogroup"
              aria-labelledby="account-setup-skin"
              className="account-setup-roles"
            >
              {SKINS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={skin === item.id}
                  className="account-setup-role"
                  onClick={() => onSkin?.(item.id)}
                >
                  {item.label}
                  <span className="account-setup-role-mark" aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="settings-form-actions">
              <button className="settings-button primary" type="button" onClick={onLookContinue}>
                Next
              </button>
            </div>
            <button type="button" className="settings-text-action" onClick={onBack}>
              Back
            </button>
          </>
        ) : (
          <>
            <ProfileForm key={`${account.scope}:${workRole}`} onboarding workRole={workRole!} />
            <p className="settings-footnote">You can change these in Settings anytime.</p>
            <button type="button" className="settings-text-action" onClick={onBack}>
              Back
            </button>
          </>
        )}
        <button className="settings-text-action" onClick={() => void account.signOut()}>
          Use a different account
        </button>
        {account.error && (
          <p role="alert" className="account-setup-error">
            {account.error}
          </p>
        )}
      </section>
    </main>
  );
}
