import { Link } from "@tanstack/react-router";
import { CookieConsent } from "@/components/marketing/CookieConsent";
import { FotoWordmark } from "@/components/marketing/FotoWordmark";
import "./public-details.css";

function openCookiePrefs() {
  window.dispatchEvent(new Event("foto-cookie-prefs"));
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer marketing-footer--directory">
      <nav className="marketing-footer__directory" aria-label="Footer">
        <div className="marketing-footer__column">
          <h2>Product</h2>
          <ul>
            <li>
              <Link to="/" hash="workflow">
                Features
              </Link>
            </li>
            <li>
              <Link to="/pricing">Pricing</Link>
            </li>
            <li>
              <Link to="/docs">Docs</Link>
            </li>
            <li>
              <Link to="/blog">Blog</Link>
            </li>
          </ul>
        </div>
        <div className="marketing-footer__column">
          <h2>Company</h2>
          <ul>
            <li>
              <Link to="/privacy">Privacy</Link>
            </li>
            <li>
              <Link to="/terms">Terms</Link>
            </li>
            <li>
              <Link to="/privacy" hash="cookies">
                Cookie Policy
              </Link>
            </li>
            <li>
              <button type="button" className="marketing-footer__text-btn" onClick={openCookiePrefs}>
                Cookie Preferences
              </button>
            </li>
          </ul>
        </div>
        <div className="marketing-footer__column">
          <h2>Where</h2>
          <ul>
            <li>
              <Link to="/community">Community</Link>
            </li>
          </ul>
        </div>
        <div className="marketing-footer__column">
          <h2>Connect</h2>
          <ul>
            <li>
              <a href="mailto:hello@lenslab.dev">Contact</a>
            </li>
            <li>
              <Link to="/auth" search={{ mode: "signin" }}>
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </nav>
      <div className="marketing-footer__branding">
        <p className="marketing-footer__copy">© {new Date().getFullYear()} FOTO</p>
        <FotoWordmark className="marketing-footer__mark" />
      </div>
      <CookieConsent />
    </footer>
  );
}
