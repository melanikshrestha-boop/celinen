import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { BrandMark } from "@/components/marketing/BrandMark";
import { useAccount } from "@/components/account/AccountProvider";
import {
  SOCIAL_NETWORKS,
  connectSocial,
  isSocialConnected,
  readSocialLinks,
  shownSocials,
  type SocialId,
  type SocialLink,
} from "@/lib/social-accounts";
import "./social-accounts.css";

export function SocialDock({ mini = false }: { mini?: boolean }) {
  const account = useAccount();
  const scope = account?.scope;
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    const load = () => {
      void readSocialLinks(scope).then((rows) => {
        if (alive) setLinks(rows);
      });
    };
    load();
    window.addEventListener("celinen:socials", load);
    return () => {
      alive = false;
      window.removeEventListener("celinen:socials", load);
    };
  }, [scope]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  async function toggle(id: SocialId) {
    if (!scope) return;
    if (isSocialConnected(links, id)) return;
    setLinks(await connectSocial(scope, id));
  }

  const shown = shownSocials(links);

  return (
    <div className={`social-dock${mini ? " is-mini" : ""}`} ref={wrap}>
      {!mini
        ? shown.map((row) => (
            <a
              key={row.id}
              href="/publish"
              className="social-dock__chip"
              title={SOCIAL_NETWORKS.find((item) => item.id === row.id)?.title}
            >
              <BrandMark id={row.id} />
            </a>
          ))
        : null}
      <button
        type="button"
        className="social-dock__plus"
        aria-label="Add social account"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={16} strokeWidth={2} />
      </button>
      {open ? (
        <div className="social-picker" role="menu" aria-label="Social accounts">
          {SOCIAL_NETWORKS.map((network) => {
            const on = isSocialConnected(links, network.id);
            return (
              <button
                key={network.id}
                type="button"
                className="social-picker__row"
                role="menuitem"
                onClick={() => void toggle(network.id)}
              >
                <span className="social-picker__mark">
                  <BrandMark id={network.id} />
                </span>
                <span>
                  <strong>{network.title}</strong>
                  <small>{network.kind}</small>
                </span>
                {on ? (
                  <Check size={18} strokeWidth={2.4} className="social-picker__check" />
                ) : (
                  <span className="social-picker__go" aria-hidden="true">
                    →
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
