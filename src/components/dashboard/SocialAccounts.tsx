import { useRef, useState } from "react";
import { Hash, Image, Paperclip, Sparkles } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import "./social-accounts.css";

const SUGGEST = ["Game day keepers", "Gallery tonight", "Sideline set", "Wedding recap"];

export function SocialAccounts() {
  const navigate = useNavigate();
  const box = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const file = useRef<HTMLInputElement>(null);

  return (
    <div className="social-post">
      <div className="social-post__hero">
        <span className="social-post__mark" aria-hidden="true">
          <Sparkles size={22} strokeWidth={1.8} />
        </span>
        <h1>What should we post?</h1>
      </div>
      <form
        className="social-post__composer"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <textarea
          ref={box}
          rows={5}
          value={draft}
          placeholder="Describe the post"
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="social-post__bar">
          <button type="button" className="social-post__chip">
            <Hash size={16} />
            Hashtags
          </button>
          <button
            type="button"
            className="social-post__chip"
            onClick={() => file.current?.click()}
          >
            <Image size={16} />
            Images
          </button>
          <span className="social-post__spacer" />
          <button
            type="button"
            className="social-post__icon"
            aria-label="Attach"
            onClick={() => file.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <button type="submit" className="social-post__send" disabled={!draft.trim()} aria-label="Send">
            ↑
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
        {SUGGEST.map((item) => (
          <button key={item} type="button" onClick={() => setDraft((value) => value || item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
