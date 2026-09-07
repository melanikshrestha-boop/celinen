import { LogoMark } from "@/components/lensos/Logo";
import { useAccount } from "./AccountProvider";
import { ProfileForm } from "./ProfileForm";
import "./account.css";

/** Only mounted after verified authentication, before any private shoot is loaded. */
export function AccountSetup() {
  const account = useAccount()!;
  return (
    <main className="workbench-lock account-setup">
      <div className="account-setup-content">
        <a href="/" className="account-setup-brand" aria-label="LensLabs home">
          <LogoMark size={28} /> LensLabs
        </a>
        <h1>Make yourself at home.</h1>
        <p className="account-setup-email">
          Signed in as <span>{account.user?.email}</span>
        </p>
        <ProfileForm key={account.scope} onboarding />
        <p className="settings-footnote">You can change these in Settings anytime.</p>
        <button className="settings-text-action" onClick={() => void account.signOut()}>
          Use a different account
        </button>
        {account.error && <p role="alert">{account.error}</p>}
      </div>
    </main>
  );
}
