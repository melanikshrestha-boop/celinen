import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  Images,
  Plug,
  Receipt,
  Scissors,
  SlidersHorizontal,
  UserSearch,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavMenu } from "@/components/marketing/nav-menu";

const FEATURES = [
  {
    to: "/product",
    hash: "smart-cull",
    icon: Scissors,
    title: "Smart Cull",
    copy: "Suggested rejects. You keep the last word.",
  },
  {
    to: "/product",
    hash: "develop",
    icon: SlidersHorizontal,
    title: "Develop",
    copy: "Your look stays with the photograph.",
  },
  {
    to: "/galleries",
    icon: Images,
    title: "Galleries",
    copy: "Send the set the same night.",
  },
  {
    to: "/galleries",
    hash: "who",
    icon: UserSearch,
    title: "Who is in this photo",
    copy: "Jersey, bib, roster — every frame of one athlete.",
  },
  {
    to: "/earnings",
    icon: Receipt,
    title: "Stripe books",
    copy: "Collected, expenses, and invoices in one place.",
  },
  {
    to: "/mcp",
    icon: Plug,
    title: "celinen MCP",
    copy: "Connect celinen to Claude, ChatGPT, Cursor, and Grok.",
  },
] as const;

export function FeaturesMenu() {
  const menu = useNavMenu("features");
  return (
    <DropdownMenu modal {...menu}>
      <DropdownMenuTrigger className="marketing-nav__link">
        Features
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="marketing-nav-menu marketing-nav-features marketing-nav-features--long"
      >
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <DropdownMenuItem key={feature.title} asChild>
              <Link
                to={feature.to}
                hash={"hash" in feature ? feature.hash : undefined}
                className="marketing-nav-feature"
              >
                <span className="marketing-nav-feature__icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.6} />
                </span>
                <span>
                  <strong>{feature.title}</strong>
                  <span>{feature.copy}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem asChild>
          <Link to="/product" className="marketing-nav-features__all">
            View all features
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
