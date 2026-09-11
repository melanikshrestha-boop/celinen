import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { BrandMark } from "@/components/marketing/BrandMark";
import { useAccount } from "@/components/account/AccountProvider";
import {
  MAIL_NETWORKS,
  SOCIAL_NETWORKS,
  connectMail,
  connectSocial,
  disconnectMail,
  disconnectSocial,
  isMailConnected,
  isSocialConnected,
  readMailLinks,
  readSocialLinks,
  shownSocials,
  type MailId,
  type MailLink,
  type SocialId,
  type SocialLink,
} from "@/lib/social-accounts";
import "./social-accounts.css";

export function SocialDock({ mini = false }: { mini?: boolean }) {
  const account = useAccount();
  const scope = account?.scope;
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [mail, setMail] = useState<MailLink[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const justOn = useRef<string | null>(null);

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    const loadSocial = () => {
      void readSocialLinks(scope).then((rows) => {
        if (alive) setLinks(rows);
      });
    };
    const loadMail = () => {
      void readMailLinks(scope).then((rows) => {
        if (alive) setMail(rows);
      });
    };
    loadSocial();
    loadMail();
    window.addEventListener("celinen:socials", loadSocial);
    window.addEventListener("celinen:mail", loadMail);
    return () => {
      alive = false;
      window.removeEventListener("celinen:socials", loadSocial);
      window.removeEventListener("celinen:mail", loadMail);
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

  function markJustOn(id: string) {
    justOn.current = id;
    window.setTimeout(() => {
      if (justOn.current === id) justOn.current = null;
    }, 400);
  }

  async function connect(id: SocialId) {
    if (!scope || isSocialConnected(links, id)) return;
    markJustOn(id);
    setLinks(await connectSocial(scope, id));
  }

  async function dropSocial(id: SocialId) {
    if (!scope || justOn.current === id || !isSocialConnected(links, id)) return;
    setLinks(await disconnectSocial(scope, id));
  }

  async function connectInbox(id: MailId) {
    if (!scope || isMailConnected(mail, id)) return;
    markJustOn(id);
    setMail(await connectMail(scope, id));
  }

  async function dropMail(id: MailId) {
    if (!scope || justOn.current === id || !isMailConnected(mail, id)) return;
    setMail(await disconnectMail(scope, id));
  }

  const shown = shownSocials(links);
  const gmailOn = isMailConnected(mail, "gmail");

  return (
    <div className={`social-dock${mini ? " is-mini" : ""}`} ref={wrap}>
      {!mini
        ? shown.map((row) => (
            <a
              key={row.id}
              href="/publish"
              className="social-dock__chip"
              title={`${SOCIAL_NETWORKS.find((item) => item.id === row.id)?.title} — double-click to disconnect`}
              onClick={(event) => {
                if (event.detail > 1) event.preventDefault();
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                void dropSocial(row.id);
              }}
            >
              <BrandMark id={row.id} />
            </a>
          ))
        : null}
      {!mini && gmailOn ? (
        <button
          type="button"
          className="social-dock__chip"
          title="Gmail — double-click to disconnect"
          onDoubleClick={() => void dropMail("gmail")}
        >
          <BrandMark id="gmail" />
        </button>
      ) : null}
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
                title={on ? "Double-click to disconnect" : undefined}
                onClick={() => void connect(network.id)}
                onDoubleClick={() => void dropSocial(network.id)}
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
          <div className="social-picker__rule" aria-hidden="true" />
          {MAIL_NETWORKS.map((network) => {
            const on = isMailConnected(mail, network.id);
            return (
              <button
                key={network.id}
                type="button"
                className="social-picker__row"
                role="menuitem"
                title={on ? "Double-click to disconnect" : undefined}
                onClick={() => void connectInbox(network.id)}
                onDoubleClick={() => void dropMail(network.id)}
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
