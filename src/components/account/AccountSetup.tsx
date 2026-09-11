import { useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { PRODUCT_NAME } from "@/lib/product";
import {
  PHOTOGRAPHER_WORK_ROLES,
  type PhotographerWorkRole,
} from "@/lib/photographer-work-roles";
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
};

/** Only mounted after verified authentication, before any private shoot is loaded. */
export function AccountSetup() {
  const account = useAccount()!;
  const [workRole, setWorkRole] = useState<PhotographerWorkRole | null>(null);
  const [step, setStep] = useState<"who" | "profile">("who");
  return (
    <AccountSetupView
      account={account}
      workRole={workRole}
      step={step}
      onPick={setWorkRole}
      onContinue={() => {
        if (workRole) setStep("profile");
      }}
      onBack={() => setStep("who")}
    />
  );
}

export function AccountSetupView({
  account,
  workRole,
  step,
  onPick,
  onContinue,
  onBack,
}: {
  account: SetupAccount;
  workRole: PhotographerWorkRole | null;
  step: "who" | "profile";
  onPick: (role: PhotographerWorkRole) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const asking = step === "who";
  return (
    <main className="auth-screen account-setup">
      <div className="auth-scene">
        <img
          className="auth-scene-image"
          src="/images/foto-open-sky.webp"
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
          <h1 id="account-setup-title">{asking ? "Who are you?" : "Make yourself at home."}</h1>
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
