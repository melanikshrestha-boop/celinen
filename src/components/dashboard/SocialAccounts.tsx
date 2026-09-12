import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Briefcase,
  Flag,
  Hash,
  Heart,
  Image,
  LayoutTemplate,
  Megaphone,
  Mic,
  Paperclip,
  Sparkles,
  Target,
  Type,
  Zap,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BrandMark } from "@/components/marketing/BrandMark";
import { PRODUCT_NAME } from "@/lib/product";
import { onHapticPress } from "@/lib/haptic-press";
import { useAccount } from "@/components/account/AccountProvider";
import {
  SOCIAL_NETWORKS,
  readSocialLinks,
  shownSocials,
  type SocialLink,
} from "@/lib/social-accounts";
import {
  buildSocialPost,
  composeAction,
  readSocialDraft,
  type SocialPost,
} from "@/lib/social-post";
import "./social-accounts.css";

const TONES = ["Professional", "Casual", "Warm"] as const;
const LENGTHS = ["Short", "Medium", "Long"] as const;
const SUGGEST = [
  { label: "Game day keepers", icon: Flag },
  { label: "Gallery tonight", icon: Image },
  { label: "Sideline set", icon: Target },
  { label: "Wedding recap", icon: Heart },
] as const;

export function SocialAccounts() {
  const navigate = useNavigate();
  const account = useAccount();
  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("Professional");
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("Medium");
  const [open, setOpen] = useState<"tone" | "length" | null>(null);
  const [wantTags, setWantTags] = useState(true);
  const [post, setPost] = useState<SocialPost | null>(null);
  const [copied, setCopied] = useState("");
  const [links, setLinks] = useState<SocialLink[]>([]);

  useEffect(() => {
    const incoming = readSocialDraft();
    if (incoming) {
      setDraft(incoming.idea);
      setTone(incoming.tone);
      setLength(incoming.length);
      setWantTags(incoming.hashtags.length > 0);
      setPost(incoming);
    }
  }, []);

  useEffect(() => {
    const scope = account?.scope;
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
  }, [account?.scope]);

  function makePost(idea = draft) {
    const text = idea.trim();
    if (!text) return;
    setPost(
      buildSocialPost({
        idea: text,
        tone,
        length,
        hashtags: wantTags,
      }),
    );
    setCopied("");
  }

  async function copyCaption(text: string, id = "caption") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied("");
    }
  }

  const targets = shownSocials(links);

  function listen() {
    const Ctor = (
      window as unknown as {
        webkitSpeechRecognition?: new () => {
          lang: string;
          start: () => void;
          onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        };
      }
    ).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript?.trim();
      if (said) setDraft((value) => (value ? `${value} ${said}` : said));
    };
    rec.start();
  }

  return (
    <div className="social-post" onPointerDown={onHapticPress}>
      <div className="social-post__chrome">
        <button
          type="button"
          className="social-post__back"
          aria-label="Back"
          onClick={() => void navigate({ to: "/dashboard" })}
        >
          <ArrowLeft size={18} />
        </button>
        <p className="social-post__inside">
          Generate inside
          <Link to="/mcp">
            <BrandMark id="claude" />
            Claude
          </Link>
          <span aria-hidden="true">|</span>
          <Link to="/mcp">
            <BrandMark id="chatgpt" />
            ChatGPT
          </Link>
        </p>
      </div>
      <div className="social-post__stage">
        <div className="social-post__hero">
          <div className="social-post__title">
            <span className="social-post__mark" aria-hidden="true">
              <Sparkles size={22} strokeWidth={1.8} />
            </span>
            <h1>What should we post?</h1>
          </div>
          <p>Turn a simple idea into a polished, on-brand social post ready to refine and publish.</p>
        </div>
        <form
          className="social-post__composer"
          onSubmit={(event) => {
            event.preventDefault();
            makePost();
          }}
        >
          <textarea
            ref={box}
            rows={6}
            value={draft}
            placeholder={`Describe the post you want ${PRODUCT_NAME} to create...`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="social-post__bar">
            <button
              type="button"
              className="social-post__chip"
              aria-pressed={wantTags}
              onClick={() => setWantTags((value) => !value)}
            >
              <Hash size={16} />
              Hashtags
            </button>
            <button type="button" className="social-post__chip" onClick={() => file.current?.click()}>
              <Image size={16} />
              Images
            </button>
            <span className="social-post__menu">
              <button
                type="button"
                className="social-post__chip"
                aria-expanded={open === "tone"}
                onClick={() => setOpen((value) => (value === "tone" ? null : "tone"))}
              >
                <Briefcase size={16} />
                {tone}
              </button>
              {open === "tone" ? (
                <span className="social-post__pop" role="listbox">
                  {TONES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setTone(item);
                        setOpen(null);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
            <span className="social-post__menu">
              <button
                type="button"
                className="social-post__chip"
                aria-expanded={open === "length"}
                onClick={() => setOpen((value) => (value === "length" ? null : "length"))}
              >
                <Type size={16} />
                {length}
              </button>
              {open === "length" ? (
                <span className="social-post__pop" role="listbox">
                  {LENGTHS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setLength(item);
                        setOpen(null);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
            <span className="social-post__spacer" />
            <Link to="/pricing" className="social-post__credits" title="Credits">
              <Zap size={14} />
              1
            </Link>
            <button
              type="button"
              className="social-post__icon"
              aria-label="Attach"
              onClick={() => file.current?.click()}
            >
              <Paperclip size={18} />
            </button>
            <button type="button" className="social-post__icon" aria-label="Voice" onClick={listen}>
              <Mic size={18} />
            </button>
            <button type="submit" className="social-post__send" disabled={!draft.trim()} aria-label="Send">
              <ArrowUp size={18} />
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={() => {
              void navigate({ to: "/studio" });
            }}
          />
        </form>
        {post ? (
          <div className="social-post__result">
            <label>
              Caption
              <textarea
                rows={8}
                value={post.caption}
                onChange={(event) => setPost({ ...post, caption: event.target.value })}
              />
            </label>
            <div className="social-post__publish">
              <button type="button" onClick={() => void copyCaption(post.caption)}>
                {copied === "caption" ? "Copied" : "Copy caption"}
              </button>
              {targets.length ? (
                targets.map((row) => {
                  const action = composeAction(row.id, post.caption);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        void copyCaption(post.caption, row.id);
                        if (action.href) window.open(action.href, "_blank", "noopener,noreferrer");
                      }}
                      title={action.hint}
                    >
                      <BrandMark id={row.id} />
                      {SOCIAL_NETWORKS.find((item) => item.id === row.id)?.title}
                    </button>
                  );
                })
              ) : (
                <Link to="/dashboard" className="social-post__connect">
                  Connect an account in the rail, then post from here
                </Link>
              )}
            </div>
            <p className="social-post__hint">
              Review the caption, then post from a connected account. Nothing is sent until you do.
            </p>
          </div>
        ) : null}
        <div className="social-post__suggest">
          <span>Suggestions</span>
          {SUGGEST.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.label} type="button" onClick={() => setDraft((value) => value || item.label)}>
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="social-post__cards">
          <button
            type="button"
            className="social-post__card"
            onClick={() =>
              setDraft((value) =>
                value
                  ? `Campaign across connected accounts:\n${value}`
                  : "Campaign across connected accounts: gallery tonight, then the sideline set.",
              )
            }
          >
            <span className="social-post__card-mark is-campaign" aria-hidden="true">
              <Megaphone size={18} />
            </span>
            <span>
              <strong>Planning multiple posts?</strong>
              <small>Turn this idea into a coordinated campaign with multiple scheduled posts.</small>
            </span>
            <em>
              Create a campaign
              <span aria-hidden="true">→</span>
            </em>
          </button>
          <Link to="/studio" className="social-post__card">
            <span className="social-post__card-mark is-studio" aria-hidden="true">
              <LayoutTemplate size={18} />
            </span>
            <span>
              <strong>Want to design it yourself?</strong>
              <small>Choose the frames in Pick, then finish the look in Develop.</small>
            </span>
            <em>
              Browse templates
              <span aria-hidden="true">→</span>
            </em>
          </Link>
        </div>
      </div>
    </div>
  );
}
