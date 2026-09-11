import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "./MarketingFooter";
import { useMarketingMotion } from "./useMarketingMotion";
import "./marketing-page.css";
import "./sky-entry.css";
import "./public-details.css";

export function PublicPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const motion = useMarketingMotion(title);
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <div className="marketing-public-page__intro marketing-enter">
          {eyebrow && <p className="marketing-value__eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
