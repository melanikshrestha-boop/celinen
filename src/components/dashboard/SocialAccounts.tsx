import { useRef, useState } from "react";
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
  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("Professional");
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("Medium");
  const [open, setOpen] = useState<"tone" | "length" | null>(null);

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
    <div className="social-post">
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
            <button type="button" className="social-post__chip">
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
