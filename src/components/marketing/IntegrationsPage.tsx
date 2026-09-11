import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/marketing/BrandMark";
import {
  INTEGRATION_GROUPS,
  integrationsInGroup,
  type PublicIntegration,
} from "@/lib/public-integrations";
import "./integrations-page.css";

function Card({ item }: { item: PublicIntegration }) {
  return (
    <Link to="/integrations/$slug" params={{ slug: item.id }} className="foto-integrations__card">
      <span className="foto-integrations__mark" aria-hidden="true">
        <BrandMark id={item.id} />
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>{item.group === "social" ? "Social" : item.group[0]!.toUpperCase() + item.group.slice(1)}</small>
        <em>{item.copy}</em>
      </span>
    </Link>
  );
}

export function IntegrationsPage() {
  return (
    <div className="foto-integrations">
      <header className="foto-integrations__intro" data-reveal>
        <h1>Integrations.</h1>
      </header>
      {INTEGRATION_GROUPS.map((group) => {
        const items = integrationsInGroup(group.id);
        return (
          <section
            key={group.id}
            id={group.id}
            className="foto-integrations__group"
            data-reveal
            aria-labelledby={`${group.id}-heading`}
          >
            <div className="foto-integrations__group-head">
              <h2 id={`${group.id}-heading`}>{group.title}</h2>
              <span>{items.length}</span>
            </div>
            <div className="foto-integrations__grid">
              {items.map((item) => (
                <Card key={item.id} item={item} />
              ))}
            </div>
          </section>
        );
      })}
      <section className="foto-integrations__missing" data-reveal>
        <h2>Missing an integration?</h2>
        <div className="foto-integrations__missing-actions">
          <Link to="/docs">View API</Link>
          <Link to="/mcp">MCP</Link>
        </div>
      </section>
    </div>
  );
}
