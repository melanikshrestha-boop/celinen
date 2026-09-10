import { Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/marketing/PublicPage";

const pages = {
  help: {
    title: "LensLabs help",
    paragraphs: [
      "Open Settings to manage your workspace preferences. For a failed save, keep the page open and retry after checking browser storage or your sign-in.",
    ],
  },
  docs: {
    title: "LensLabs documentation",
    paragraphs: [
      "This guide describes the current browser workspace. Desktop integrations and paid services are available only where a connected runtime is shown.",
    ],
  },
  settings: {
    title: "Settings guide",
    paragraphs: [
      "Preferences save after each valid change, separately for each account on this browser. Profile fields require Save changes. Search finds controls without changing their values.",
      "Theme and settings imports accept bounded LensLabs JSON, show a confirmation, and never execute code. Imported preferences cannot enable cloud sharing or desktop notifications. Changing the theme does not modify photographs.",
      "Profile identity is private workspace metadata. A local development persona is not an authenticated account. The Account page and connection screens distinguish local state from verified provider identity.",
    ],
  },
  permissions: {
    title: "Workspace permissions",
    paragraphs: [
      "A web preference cannot grant arbitrary filesystem access, shell execution or control of another application. Import reads files you choose; edits are separate from originals.",
      "Microphone tests and screen captures require an explicit action and a browser permission prompt. The microphone test measures input level without storing or uploading audio. Screen capture retains one image for preview and stops the stream.",
      "Publishing, sending, billing and other consequential operations remain separate actions. Imports and appearance settings do not authorize them.",
    ],
  },
  privacy: {
    title: "Privacy policy",
    paragraphs: [
      "A published privacy policy has not been configured for this build. This page is not a substitute for the site owner’s reviewed policy. No legal terms or data-retention guarantees are implied.",
    ],
  },
  terms: {
    title: "Terms of service",
    paragraphs: [
      "Reviewed terms of service have not been configured for this build. This page does not create subscription, licensing or cancellation terms.",
    ],
  },
  security: {
    title: "Security information",
    paragraphs: [
      "See Workspace permissions for the controls implemented in this build. A public security contact and security disclosures have not been configured. No security certification is claimed.",
    ],
  },
} as const;
export type SettingsGuidePage = keyof typeof pages;
export function SettingsGuide({ page }: { page: SettingsGuidePage }) {
  const entry = pages[page];
  return (
    <PublicPage eyebrow="A little clarity" title={entry.title.replace(/^LensLabs/, "FOTO")}>
      <div className="marketing-guide-copy" data-reveal>
        {entry.paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <nav className="marketing-guide-links" aria-label="FOTO guides">
        <Link to="/settings/$section" params={{ section: "general" }}>
          Open Settings →
        </Link>
        <Link to="/docs/settings">Settings guide</Link>
        <Link to="/docs/permissions">Workspace permissions</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/security">Security</Link>
      </nav>
    </PublicPage>
  );
}
