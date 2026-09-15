import { Link } from "@tanstack/react-router";
import { CookieConsent } from "@/components/marketing/CookieConsent";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product";
import { COMPARE_ENTRIES } from "@/lib/public-compare";
import { PUBLIC_SOCIALS } from "@/lib/public-socials";
import "./public-details.css";

function openCookiePrefs() {
  window.dispatchEvent(new Event("foto-cookie-prefs"));
}

export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="marketing-footer marketing-footer--directory">
      <nav className="marketing-footer__directory" aria-label="Footer">
        <div className="marketing-footer__column">
          <h2>Why {PRODUCT_NAME}</h2>
          <ul>
            {COMPARE_ENTRIES.map((entry) => (
              <li key={entry.id}>
                <Link to="/vs/$slug" params={{ slug: entry.id }}>
                  {PRODUCT_NAME} vs. {entry.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="marketing-footer__column">
          <h2>Product</h2>
          <ul>
            <li>
              <Link to="/" hash="workflow">
                Features
              </Link>
            </li>
            <li>
              <Link to="/use-cases">Use Cases</Link>
            </li>
            <li>
              <Link to="/integrations">Integrations</Link>
            </li>
            <li>
              <Link to="/compare">Compare</Link>
            </li>
            <li>
              <Link to="/affiliates">Affiliates</Link>
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
              <Link to="/legal/cookies">Cookie Policy</Link>
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
            {PUBLIC_SOCIALS.map((social) => (
              <li key={social.href}>
                <a href={social.href} target="_blank" rel="noopener noreferrer">
                  {social.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="marketing-footer__column">
          <h2>Connect</h2>
          <ul>
            <li>
              <Link to="/docs">Get an API key</Link>
            </li>
            <li>
              <Link to="/mcp">MCP server</Link>
            </li>
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
      <div className="marketing-footer__legal">
        <p>
          © {year} {PRODUCT_NAME}. All rights reserved.
        </p>
        <p>{PRODUCT_TAGLINE}</p>
      </div>
      <p className="marketing-footer__giant" aria-hidden="true">
        {PRODUCT_NAME}
      </p>
      <CookieConsent />
    </footer>
  );
}
