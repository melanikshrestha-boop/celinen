import { useEffect, useRef, useState } from "react";
import { Copy, Mail, MessageCircle, Share2 } from "lucide-react";
import { customerEmailDraft, customerSmsDraft } from "@/lib/customer-message";
import "./customer-message.css";

/** User-reviewed drafts; opening an app or share sheet never records a sent event. */
export function MessageComposer({
  title,
  text,
  beforeAction,
  hideCopy = false,
}: {
  title: string;
  text: string;
  beforeAction?: () => void;
  hideCopy?: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const alive = useRef(true);
  const smsRevision = useRef(0);
  const current = useRef({ title, text });
  current.current = { title, text };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const guard = () => {
    if (!alive.current || current.current.text !== text || current.current.title !== title)
      throw new Error("The message changed. Review it again before sharing.");
    beforeAction?.();
  };
  const action = async (run: () => Promise<void> | void) => {
    setError("");
    setNotice("");
    try {
      guard();
      await run();
    } catch (cause) {
      if (alive.current && !(cause instanceof DOMException && cause.name === "AbortError"))
        setError(cause instanceof Error ? cause.message : "Could not open the message draft.");
    }
  };
  return (
    <div className="customer-message">
      <div className="customer-message-actions">
        {!hideCopy && (
          <button
            type="button"
            onClick={() =>
              void action(async () => {
                await navigator.clipboard.writeText(text);
                guard();
                setNotice("Message copied. Review your recipient before sending.");
              })
            }
          >
            <Copy size={15} />
            Copy Text
          </button>
        )}
        {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
          <button
            type="button"
            disabled={sharing}
            onClick={() =>
              void action(async () => {
                setSharing(true);
                try {
                  await navigator.share({ title, text });
                  guard();
                  setNotice("Share handoff finished. Celinen cannot confirm message delivery.");
                } finally {
                  if (alive.current) setSharing(false);
                }
              })
            }
          >
            <Share2 size={15} />
            Share…
          </button>
        )}
      </div>
      <details>
        <summary>Text or Email a Customer</summary>
        <label>
          Customer Phone
          <input
            type="tel"
            autoComplete="off"
            value={phone}
            onChange={(event) => {
              // Invalidate immediately, even before React renders the new value.
              smsRevision.current++;
              setPhone(event.target.value);
            }}
            placeholder="Include country code"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void action(async () => {
              const revision = ++smsRevision.current;
              const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform + navigator.userAgent);
              const href = customerSmsDraft(phone, text, apple);
              if (apple) {
                await navigator.clipboard.writeText(text);
                guard();
                if (smsRevision.current !== revision)
                  throw new Error(
                    "The phone number or draft changed. Review it and open the text draft again.",
                  );
              }
              setNotice(
                apple
                  ? "Receipt or invitation copied. Paste into Messages, review, then send."
                  : "Review and send in your messaging app. If it did not open, use Copy Text.",
              );
              window.location.assign(href);
            })
          }
        >
          <MessageCircle size={15} />
          Open Text Draft
        </button>
        <label>
          Customer Email
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void action(() => {
              const href = customerEmailDraft(email, title, text);
              setNotice("Review and send in your email app. If it did not open, use Copy Text.");
              window.location.assign(href);
            })
          }
        >
          <Mail size={15} />
          Open Email Draft
        </button>
        <p>Your messaging app sends it. Nothing is sent automatically.</p>
      </details>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error} You can select and copy the message below.</p>}
      <details>
        <summary>Review Message</summary>
        <textarea
          aria-label="Customer message"
          readOnly
          value={text}
          onFocus={(event) => event.target.select()}
        />
      </details>
    </div>
  );
}
