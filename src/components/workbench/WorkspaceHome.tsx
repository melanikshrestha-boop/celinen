import type { ComponentType } from "react";
import { Camera, Images, Send, SlidersHorizontal, UsersRound, Wallet } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useWorkbench, type WorkbenchContextValue } from "./context";
import "./workspace-home.css";

const STILL = "/images/foto-open-sky.webp";

const START = [
  {
    crop: "sky",
    title: "Import a shoot",
    Icon: Camera,
    run: (workbench: WorkbenchContextValue | null) => void workbench?.newShoot?.(),
  },
  {
    crop: "ridge",
    title: "Pick the keepers",
    Icon: Images,
    run: (workbench: WorkbenchContextValue | null) => void workbench?.openTool("/shoots"),
  },
  {
    crop: "lake",
    title: "Send a gallery",
    Icon: Send,
    run: (workbench: WorkbenchContextValue | null) => void workbench?.openTool("/deliver"),
  },
] as const;

const TOOLS: {
  href: "/library" | "/adobe" | "/clients" | "/earnings";
  label: string;
  Icon: ComponentType<{ size?: number }>;
}[] = [
  { href: "/library", label: "Library", Icon: Images },
  { href: "/adobe", label: "Adobe", Icon: SlidersHorizontal },
  { href: "/clients", label: "Clients", Icon: UsersRound },
  { href: "/earnings", label: "Earnings", Icon: Wallet },
];

function givenName(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first || first.toLowerCase() === "your") return "";
  return first;
}

export function WorkspaceHome() {
  const account = useAccount();
  const workbench = useWorkbench();
  const name = givenName(account?.name ?? "");

  return (
    <div className="foto-home">
      <div className="foto-home__stage">
        <header className="foto-home__hero">
          <h1>
            {name ? `Welcome back, ${name}. ` : null}
            Let’s make <em>something worth sending.</em>
          </h1>
          <img className="foto-home__still" src={STILL} alt="" width={220} height={148} />
        </header>
        <div className="foto-home__cards">
          {START.map(({ crop, title, Icon, run }) => (
            <button
              key={crop}
              type="button"
              className="foto-home__card"
              data-crop={crop}
              onClick={() => run(workbench)}
            >
              <span className="foto-home__card-still">
                <img src={STILL} alt="" />
              </span>
              <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <h2>{title}</h2>
            </button>
          ))}
        </div>
        <section className="foto-home__tools" aria-labelledby="foto-home-tools">
          <h2 id="foto-home-tools">Tools</h2>
          <div className="foto-home__tools-row">
            {TOOLS.map(({ href, label, Icon }) => (
              <button key={href} type="button" onClick={() => void workbench?.openTool(href)}>
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
