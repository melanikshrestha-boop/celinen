import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import "./public-details.css";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Explore FOTO", to: "/product" },
      { label: "Pricing", to: "/pricing" },
      { label: "How it works", to: "/", hash: "workflow" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", to: "/blog" },
      { label: "Documentation", to: "/docs" },
      { label: "What’s new", to: "/changelog" },
      { label: "Help", to: "/help" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About FOTO", to: "/product", hash: "why-foto" },
      { label: "Our approach", to: "/product", hash: "your-work" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "Security", to: "/security" },
      { label: "Permissions", to: "/docs/permissions" },
    ],
  },
] as const;

export function MarketingFooter() {
  const entry = publicEntry(useAccount()?.status);
  return (
    <footer className="marketing-footer marketing-footer--directory">
      <div className="marketing-footer__intro" data-reveal>
        <Link to="/" className="marketing-footer__brand">
          foto
        </Link>
        <p>
          A little more room
          <br />
          for what you love.
        </p>
        <span className="marketing-footer__note">
          <Heart size={15} aria-hidden="true" /> Made for the person behind the camera.
        </span>
      </div>
      <nav className="marketing-footer__directory" aria-label="Footer">
        {columns.map((column) => (
          <div key={column.title} className="marketing-footer__column" data-reveal>
            <h2>{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} {...("hash" in link ? { hash: link.hash } : {})}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {column.title === "Company" && (
                <li>
                  <Link to={entry.to} search={entry.search}>
                    Your workspace
                  </Link>
                </li>
              )}
            </ul>
          </div>
        ))}
      </nav>
      <div className="marketing-footer__bottom">
        <span>© {new Date().getFullYear()} FOTO</span>
        <span>Your work. Your way.</span>
      </div>
    </footer>
  );
}
