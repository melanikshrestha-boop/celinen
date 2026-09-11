import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Home,
  Images,
  Scissors,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { LogoMark } from "@/components/lensos/Logo";
import { PRODUCT_NAME } from "@/lib/product";
import "./dashboard.css";

const MAIN = [
  { to: "/dashboard", label: "Home", icon: Home, end: true },
  { to: "/shoots", label: "Pick", icon: Scissors },
  { to: "/deliver", label: "Galleries", icon: Images },
  { to: "/develop", label: "Develop", icon: SlidersHorizontal },
  { to: "/earnings", label: "Analytics", icon: BarChart3 },
  { to: "/publish", label: "Social accounts", icon: Share2 },
  { to: "/library", label: "Tools", icon: Wrench },
] as const;

const FOOT = [
  { to: "/pricing", label: "Upgrade", icon: Sparkles, tone: "upgrade" },
  { to: "/docs", label: "Guide", icon: BookOpen },
  { to: "/community", label: "Community", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function initial(name: string) {
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "C";
}

export function AppDashboard() {
  const account = useAccount();
  const navigate = useNavigate();

  useEffect(() => {
    if (account?.status === "out")
      void navigate({
        to: "/auth",
        search: { next: "/dashboard", mode: "signin", google: true },
        replace: true,
      });
  }, [account?.status, navigate]);

  const loading = !account || account.status === "loading" || account.status === "out";
  const name = account?.name?.trim() || PRODUCT_NAME;

  return (
    <div className="celinen-dash">
      <aside className="celinen-dash__rail">
        <div className="celinen-dash__brand">
          <LogoMark size={22} />
          <span>{PRODUCT_NAME}</span>
        </div>
        <nav className="celinen-dash__nav" aria-label="Dashboard">
          {MAIN.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={item.end ? { exact: true } : undefined}
              className="celinen-dash__link"
              activeProps={{ className: "celinen-dash__link is-active" }}
            >
              <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="celinen-dash__foot">
          {FOOT.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={
                item.tone === "upgrade" ? "celinen-dash__link celinen-dash__upgrade" : "celinen-dash__link"
              }
            >
              <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </div>
      </aside>
      <div className="celinen-dash__main">
        <header className="celinen-dash__top">
          <span className="celinen-dash__avatar" aria-hidden="true">
            {initial(name)}
          </span>
          <div>
            <p>{loading ? "Loading…" : name}</p>
          </div>
        </header>
        <main className="celinen-dash__body">
          {loading ? (
            <div className="celinen-dash__loading">
              <span className="celinen-dash__spinner" aria-hidden="true" />
              <p>Loading your workspace…</p>
            </div>
          ) : (
            <div className="celinen-dash__home">
              <h1>Welcome back{name && name !== PRODUCT_NAME ? `, ${name.split(" ")[0]}` : ""}.</h1>
              <div className="celinen-dash__cards">
                <Link to="/shoots" className="celinen-dash__card" data-crop="sky">
                  <span className="celinen-dash__card-still">
                    <img src="/images/foto-open-sky.webp" alt="" />
                  </span>
                  Open a shoot
                </Link>
                <Link to="/deliver" className="celinen-dash__card" data-crop="ridge">
                  <span className="celinen-dash__card-still">
                    <img src="/images/foto-open-sky.webp" alt="" />
                  </span>
                  Send a gallery
                </Link>
                <Link to="/publish" className="celinen-dash__card" data-crop="lake">
                  <span className="celinen-dash__card-still">
                    <img src="/images/foto-open-sky.webp" alt="" />
                  </span>
                  Connect socials
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
