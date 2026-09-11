import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  copyFriendInvitation,
  friendInvitation,
  shareFriendInvitation,
} from "@/lib/friend-invitation";
import "./invite-friend.css";

export function InviteFriendDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <InvitationContent returnFocus={returnFocus} />}
    </Dialog>
  );
}

function InvitationContent({ returnFocus }: { returnFocus: RefObject<HTMLButtonElement | null> }) {
  const invitation = friendInvitation();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState<"copy" | "share" | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectLink = () => {
    input.current?.focus();
    input.current?.select();
    input.current?.setSelectionRange(0, invitation.url.length);
  };
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    setBusy("copy");
    setMessage("");
    const result = await copyFriendInvitation(invitation.url, navigator.clipboard);
    if (!mounted.current) return;
    pending.current = false;
    setBusy(null);
    if (result === "manual") selectLink();
    setMessage(
      result === "copied"
        ? "Link copied. Paste it into a message to your friend."
        : "Copying is blocked. The link is selected; use your device’s Copy action.",
    );
  }
  async function share() {
    if (pending.current) return;
    pending.current = true;
    setBusy("share");
    setMessage("");
    const result = await shareFriendInvitation(invitation, navigator.share?.bind(navigator));
    if (!mounted.current) return;
    pending.current = false;
    setBusy(null);
    setMessage(
      result === "shared"
        ? "Sharing finished."
        : result === "cancelled"
          ? "Sharing cancelled. You can try again or copy the link."
          : "Sharing isn’t available here. Copy the link instead.",
    );
  }
  return (
    <DialogContent
      className="invite-friend-dialog"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        returnFocus.current?.focus();
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        selectLink();
      }}
    >
      <DialogHeader>
        <DialogTitle>Invite a friend</DialogTitle>
        <DialogDescription>
          Give them a place to start their next shoot. They’ll create their own LensLabs account.
        </DialogDescription>
      </DialogHeader>
      <div className="invite-friend-link">
        <label htmlFor="friend-signup-link">Signup link</label>
        <input
          ref={input}
          id="friend-signup-link"
          aria-label="LensLabs invitation link"
          readOnly
          value={invitation.url}
          onFocus={(event) => event.target.select()}
        />
      </div>
      <div className="invite-friend-actions">
        <button
          type="button"
          className="settings-button primary"
          disabled={busy !== null}
          onClick={() => void copy()}
        >
          {busy === "copy" ? "Copying…" : "Copy link"}
        </button>
        {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
          <button
            type="button"
            className="settings-button"
            disabled={busy !== null}
            onClick={() => void share()}
          >
            {busy === "share" ? "Sharing…" : "Share…"}
          </button>
        )}
        <a
          className="settings-button"
          href={invitation.emailHref}
          onClick={() =>
            setMessage(
              "Your email app opens a draft. Choose a recipient and send it there. If it doesn’t open, copy the link instead.",
            )
          }
        >
          Open email draft
        </a>
      </div>
      <p className="invite-friend-feedback" role="status" aria-live="polite">
        {message}
      </p>
      <p className="invite-friend-privacy">
        Your photos, chats and workspace stay private. This link doesn’t grant access to them.
      </p>
    </DialogContent>
  );
}
