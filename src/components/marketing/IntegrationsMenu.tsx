import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/marketing/BrandMark";
import { hoverMenuTrigger, useNavMenuHover } from "@/components/marketing/nav-menu";
import { menuIntegrations } from "@/lib/public-integrations";

export function IntegrationsMenu() {
  const menu = useNavMenuHover("integrations");
  const trigger = hoverMenuTrigger(menu);
  return (
    <DropdownMenu modal={false} open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger className="marketing-nav__link" {...trigger}>
        Integrations
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        sideOffset={8}
        collisionPadding={12}
        onPointerEnter={menu.openNow}
        onPointerLeave={menu.closeSoon}
        className="marketing-nav-menu marketing-nav-features marketing-nav-integrations"
      >
        <div className="marketing-nav-integrations__grid">
          {menuIntegrations().map((item) => (
            <DropdownMenuItem key={item.id} asChild>
              <Link to="/integrations/$slug" params={{ slug: item.id }} className="marketing-nav-feature">
                <span className="marketing-nav-feature__icon" aria-hidden="true">
                  <BrandMark id={item.id} />
                </span>
                <strong>{item.title}</strong>
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuItem asChild>
          <Link to="/integrations" className="marketing-nav-features__all">
            View all integrations
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
