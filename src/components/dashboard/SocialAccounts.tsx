import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { BrandMark } from "@/components/marketing/BrandMark";
import { onHapticPress } from "@/lib/haptic-press";
import { VoiceMic } from "./VoiceMic";
import { useAccount } from "@/components/account/AccountProvider";
import {
  SOCIAL_NETWORKS,
  connectAllSocials,
  connectSocial,
  isSocialConnected,
  readSocialLinks,
  type SocialId,
  type SocialLink,
} from "@/lib/social-accounts";
import {
  hasPasteSecret,
  readPasteSecrets,
  type PasteSecret,
  type PasteSocialId,
} from "@/lib/social-paste";
import { publishPastePost } from "@/lib/social-paste-client";
import { fireCompose, readSocialDraft } from "@/lib/social-post";
import "./social-accounts.css";

export function SocialAccounts() {
  const navigate = useNavigate();
  const account = useAccount();
  const box = useRef<HTMLTextAreaElement>(null);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState("");
  const [status, setStatus] = useState("");
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [secrets, setSecrets] = useState<Partial<Record<PasteSocialId, PasteSecret>>>({});

  useEffect(() => {
    const incoming = readSocialDraft();
    if (incoming?.caption) setCaption(incoming.caption);
    else if (incoming?.idea) setCaption(incoming.idea);
  }, []);

  useEffect(() => {
    const scope = account?.scope;
    if (!scope) return;
    let alive = true;
    const load = () => {
      void readSocialLinks(scope).then((rows) => {
        if (alive) setLinks(rows);
      });
      void readPasteSecrets(scope).then((rows) => {
        if (alive) setSecrets(rows);
      });
    };
    load();
    window.addEventListener("celinen:socials", load);
    return () => {
      alive = false;
      window.removeEventListener("celinen:socials", load);
    };
  }, [account?.scope]);

  async function postTo(ids: SocialId[]) {
    const text = caption.trim();
    if (!text || !ids.length) {
      setStatus(text ? "" : "Write the caption first.");
      return;
    }
    const live = ids.filter((id) => hasPasteSecret(secrets, id));
    const rest = ids.filter((id) => !hasPasteSecret(secrets, id));
    const notes: string[] = [];
    for (const id of live) {
      const result = await publishPastePost(account?.scope ?? "", id, text);
      notes.push(
        result.ok
          ? `Posted to ${SOCIAL_NETWORKS.find((item) => item.id === id)?.title}.`
          : result.error,
      );
    }
    if (rest.length) {
      const actions = await fireCompose(rest, text);
      notes.push(
        rest.length > 1
          ? `Opened ${actions.map((item) => item.title).join(", ")}. Caption copied.`
          : actions[0]!.hint,
      );
    }
    setCopied(ids.length > 1 ? "all" : ids[0]!);
    setStatus(notes.join(" "));
  }

  async function connect(id: SocialId) {
    const scope = account?.scope;
    if (!scope) return;
    setLinks(await connectSocial(scope, id));
  }

  async function connectEvery() {
    const scope = account?.scope;
    if (!scope) return;
    setLinks(await connectAllSocials(scope));
  }

  const connected = SOCIAL_NETWORKS.filter((network) => isSocialConnected(links, network.id));

  return (
    <div className="social-board" onPointerDown={onHapticPress}>
      <div className="social-board__top">
        <button
          type="button"
          className="social-post__back"
          aria-label="Back"
          onClick={() => void navigate({ to: "/dashboard" })}
        >
          <ArrowLeft size={18} />
        </button>
        <h1>Post</h1>
      </div>
      <label className="social-board__caption">
        Caption
        <textarea
          ref={box}
          rows={4}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
        <span className="social-board__mic">
          <VoiceMic value={caption} onChange={setCaption} inputRef={box} />
        </span>
      </label>
      <ul className="social-board__places">
        {SOCIAL_NETWORKS.map((network) => {
          const on = isSocialConnected(links, network.id);
          return (
            <li key={network.id}>
              <BrandMark id={network.id} />
              <strong>{network.title}</strong>
              {on ? (
                <button
                  type="button"
                  onClick={() => void postTo([network.id])}
                  disabled={!caption.trim()}
                >
                  {copied === network.id ? "Opened" : "Post"}
                </button>
              ) : (
                <button type="button" onClick={() => void connect(network.id)}>
                  Connect
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="social-board__actions">
        {connected.length > 1 ? (
          <button
            type="button"
            className="social-post__all"
            onClick={() => void postTo(connected.map((row) => row.id))}
            disabled={!caption.trim()}
          >
            {copied === "all" ? "Opened all" : "Post to all"}
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        ) : null}
        {links.length < SOCIAL_NETWORKS.length ? (
          <button type="button" className="social-post__connect" onClick={() => void connectEvery()}>
            Connect all socials
          </button>
        ) : null}
      </div>
      {status ? <p className="social-post__hint">{status}</p> : null}
    </div>
  );
}
