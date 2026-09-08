import { useEffect, useRef, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { copyFriendInvitation, shareFriendInvitation } from "@/lib/friend-invitation";
import { publicStoryInvitation } from "@/lib/business/story-sharing";

export function StoryShare({
  id,
  title,
  creator,
}: {
  id: string;
  title: string;
  creator?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="story-share-trigger">
          <Share2 size={16} /> Share story
        </button>
      </DialogTrigger>
      {open && <StoryShareContent key={id} id={id} title={title} creator={creator} />}
    </Dialog>
  );
}
function StoryShareContent({
  id,
  title,
  creator,
}: {
  id: string;
  title: string;
  creator: string | null | undefined;
}) {
  const invitation = publicStoryInvitation(id, title, creator);
  const link = useRef<HTMLInputElement>(null);
  const pending = useRef(false),
    alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function act(kind: "copy" | "share") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    const result =
      kind === "copy"
        ? await copyFriendInvitation(invitation.url, navigator.clipboard)
        : await shareFriendInvitation(invitation, navigator.share?.bind(navigator));
    if (!alive.current) return;
    pending.current = false;
    setBusy(false);
    if (result === "manual" || result === "unavailable" || result === "failed") {
      link.current?.focus();
      link.current?.select();
    }
    setMessage(
      result === "copied"
        ? "Link copied. Paste it into your message."
        : result === "shared"
          ? "Share sheet completed."
          : result === "cancelled"
            ? "Sharing cancelled. Nothing else was sent."
            : "Use your device’s Copy action on the selected link.",
    );
  }
  return (
    <DialogContent className="story-share-dialog">
      <DialogTitle>Share this story</DialogTitle>
      <DialogDescription>
        Send this public work to someone who’ll love it. They don’t need an account to view it.
      </DialogDescription>
      <p className="story-share-credit">{invitation.text}</p>
      <label htmlFor="public-story-link">Public story link</label>
      <input
        id="public-story-link"
        ref={link}
        value={invitation.url}
        readOnly
        onFocus={(e) => e.target.select()}
      />
      <div className="story-share-actions">
        <button disabled={busy} onClick={() => void act("share")}>
          <Share2 size={16} /> Share…
        </button>
        <button disabled={busy} onClick={() => void act("copy")}>
          <Copy size={16} /> Copy link
        </button>
        <a href={invitation.emailHref}>Email draft</a>
      </div>
      <p role="status" className="story-share-status">
        {message}
      </p>
    </DialogContent>
  );
}
