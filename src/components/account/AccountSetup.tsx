import { LogoMark } from "@/components/lensos/Logo";
import { PRODUCT_NAME } from "@/lib/product";
import { useAccount } from "./AccountProvider";
import { ProfileForm } from "./ProfileForm";
import "./account.css";
import "./auth-screen.css";
import "./account-setup.css";

/** Only mounted after verified authentication, before any private shoot is loaded. */
export function AccountSetup() {
  const account = useAccount()!;
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
          <h1 id="account-setup-title">Make yourself at home.</h1>
          <p className="account-setup-email">
            Signed in as <span>{account.user?.email}</span>
          </p>
        </header>
        <ProfileForm key={account.scope} onboarding />
        <p className="settings-footnote">You can change these in Settings anytime.</p>
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
