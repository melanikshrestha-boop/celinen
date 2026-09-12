import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { BrandMark } from "@/components/marketing/BrandMark";
import { useAccount } from "@/components/account/AccountProvider";
import {
  MAIL_NETWORKS,
  SOCIAL_NETWORKS,
  connectAllSocials,
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
import {
  hasPasteSecret,
  isPasteSocial,
  parsePasteSecret,
  readPasteSecrets,
  savePasteSecret,
  type PasteSecret,
  type PasteSocialId,
} from "@/lib/social-paste";
import "./social-accounts.css";

export function SocialDock({ mini = false }: { mini?: boolean }) {
  const account = useAccount();
  const scope = account?.scope;
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [mail, setMail] = useState<MailLink[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PasteSocialId | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [secrets, setSecrets] = useState<Partial<Record<PasteSocialId, PasteSecret>>>({});
  const wrap = useRef<HTMLDivElement>(null);
  const justOn = useRef<string | null>(null);

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    const loadSocial = () => {
      void readSocialLinks(scope).then((rows) => {
        if (alive) setLinks(rows);
      });
      void readPasteSecrets(scope).then((rows) => {
        if (alive) setSecrets(rows);
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
    if (!scope) return;
    if (isPasteSocial(id) && !hasPasteSecret(secrets, id)) {
      setForm(id);
      setFields({});
      setFormError("");
      return;
    }
    if (isSocialConnected(links, id)) return;
    markJustOn(id);
    setLinks(await connectSocial(scope, id));
  }

  async function connectPaste(id: PasteSocialId) {
    if (!scope) return;
    try {
      const secret = parsePasteSecret(id, fields);
      await savePasteSecret(scope, secret);
      markJustOn(id);
      setLinks(await connectSocial(scope, id));
      setSecrets(await readPasteSecrets(scope));
      setForm(null);
      setFields({});
      setFormError("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not connect.");
    }
  }

  async function dropSocial(id: SocialId) {
    if (!scope || justOn.current === id || !isSocialConnected(links, id)) return;
    setLinks(await disconnectSocial(scope, id));
  }

  async function connectEverySocial() {
    if (!scope) return;
    setLinks(await connectAllSocials(scope));
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
          {SOCIAL_NETWORKS.length !== links.length ? (
            <button
              type="button"
              className="social-picker__all"
              onClick={() => void connectEverySocial()}
            >
              Connect all
            </button>
          ) : null}
          {SOCIAL_NETWORKS.map((network) => {
            const on = isSocialConnected(links, network.id);
            const live = hasPasteSecret(secrets, network.id);
            return (
              <div key={network.id}>
                <button
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
                    <small>{live ? "Live" : network.kind}</small>
                  </span>
                  {on ? (
                    <Check size={18} strokeWidth={2.4} className="social-picker__check" />
                  ) : (
                    <span className="social-picker__go" aria-hidden="true">
                      →
                    </span>
                  )}
                </button>
                {form === network.id ? (
                  <form
                    className="social-picker__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connectPaste(network.id);
                    }}
                  >
                    {network.id === "bluesky" ? (
                      <>
                        <input
                          aria-label="Handle"
                          autoComplete="username"
                          placeholder="Handle"
                          value={fields.handle ?? ""}
                          onChange={(event) =>
                            setFields((current) => ({ ...current, handle: event.target.value }))
                          }
                        />
                        <input
                          aria-label="App password"
                          type="password"
                          autoComplete="current-password"
                          placeholder="App password"
                          value={fields.appPassword ?? ""}
                          onChange={(event) =>
                            setFields((current) => ({
                              ...current,
                              appPassword: event.target.value,
                            }))
                          }
                        />
                      </>
                    ) : null}
                    {network.id === "mastodon" ? (
                      <>
                        <input
                          aria-label="Instance"
                          placeholder="Instance"
                          value={fields.instance ?? ""}
                          onChange={(event) =>
                            setFields((current) => ({ ...current, instance: event.target.value }))
                          }
                        />
                        <input
                          aria-label="Token"
                          type="password"
                          placeholder="Token"
                          value={fields.token ?? ""}
                          onChange={(event) =>
                            setFields((current) => ({ ...current, token: event.target.value }))
                          }
                        />
                      </>
                    ) : null}
                    {network.id === "discord" ? (
                      <input
                        aria-label="Webhook"
                        placeholder="Webhook"
                        value={fields.webhook ?? ""}
                        onChange={(event) =>
                          setFields((current) => ({ ...current, webhook: event.target.value }))
                        }
                      />
                    ) : null}
                    <div className="social-picker__form-actions">
                      <button type="submit">Connect</button>
                      <button type="button" onClick={() => setForm(null)}>
                        Cancel
                      </button>
                    </div>
                    {formError ? <p role="alert">{formError}</p> : null}
                  </form>
                ) : null}
              </div>
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
