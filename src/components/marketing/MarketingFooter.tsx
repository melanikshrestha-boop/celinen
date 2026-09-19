import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CookieConsent } from "@/components/marketing/CookieConsent";
import { LogoMark } from "@/components/lensos/Logo";
import { COMPANY_NAME } from "@/lib/lenslab-products";
import { COMPARE_ENTRIES } from "@/lib/public-compare";
import "./public-details.css";

function openCookiePrefs() {
  window.dispatchEvent(new Event("celinen-cookie-prefs"));
  window.dispatchEvent(new Event("foto-cookie-prefs"));
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="marketing-footer__group">
      <h2>{title}</h2>
      <ul>{children}</ul>
    </div>
  );
}

export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="marketing-footer marketing-footer--directory">
      <div className="marketing-footer__shell">
        <div className="marketing-footer__brand">
          <Link to="/" className="marketing-footer__logo" aria-label={`${COMPANY_NAME} home`}>
            <LogoMark size={22} />
            <span>{COMPANY_NAME}</span>
          </Link>
          <p>© {year} {COMPANY_NAME}</p>
        </div>
        <nav className="marketing-footer__directory" aria-label="Footer">
          <div className="marketing-footer__column">
            <Group title="Products">
              <li>
                <Link to="/product/celinen">Celinen</Link>
              </li>
              <li>
                <Link to="/product/heavenly">Heavenly</Link>
              </li>
              <li>
                <Link to="/product/celinen" hash="smart-cull">
                  Features
                </Link>
              </li>
              <li>
                <Link to="/blog">Blog</Link>
              </li>
            </Group>
          </div>
          <div className="marketing-footer__column">
            <Group title="Solutions">
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
                <Link to="/community">Community</Link>
              </li>
            </Group>
            <Group title="Compare">
              {COMPARE_ENTRIES.map((entry) => (
                <li key={entry.id}>
                  <Link to="/vs/$slug" params={{ slug: entry.id }}>
                    {entry.name}
                  </Link>
                </li>
              ))}
            </Group>
          </div>
          <div className="marketing-footer__column">
            <Group title="Developers">
              <li>
                <Link to="/docs">Docs</Link>
              </li>
              <li>
                <Link to="/mcp">MCP</Link>
              </li>
              <li>
                <Link to="/docs">API</Link>
              </li>
              <li>
                <Link to="/pricing">Pricing</Link>
              </li>
              <li>
                <Link to="/changelog">Changelog</Link>
              </li>
            </Group>
          </div>
          <div className="marketing-footer__column">
            <Group title="Company">
              <li>
                <Link to="/product">Products</Link>
              </li>
              <li>
                <Link to="/security">Security</Link>
              </li>
              <li>
                <Link to="/blog">Blog</Link>
              </li>
              <li>
                <Link to="/contact-sales">Sales</Link>
              </li>
              <li>
                <a href="mailto:hello@lenslab.dev">Contact</a>
              </li>
            </Group>
          </div>
          <div className="marketing-footer__column">
            <Group title="Legal">
              <li>
                <Link to="/terms">Terms</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
              <li>
                <Link to="/legal/cookies">Cookies</Link>
              </li>
              <li>
                <button type="button" className="marketing-footer__text-btn" onClick={openCookiePrefs}>
                  Privacy choices
                </button>
              </li>
            </Group>
            <Group title="Social">
              <li>
                <a href="mailto:hello@lenslab.dev">hello@lenslab.dev</a>
              </li>
            </Group>
          </div>
        </nav>
      </div>
      <CookieConsent />
    </footer>
  );
}
