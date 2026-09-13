import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Keeps the existing assistant alive while closed, including drafts and in-flight receipts. */
export function StudioChatDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-label="Ask celinen"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto h-[min(44rem,90dvh)] max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl rounded-lg border-0 bg-paper p-5 text-ink shadow-none backdrop:bg-black/50"
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Ask celinen</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="rounded-md p-1.5 hover:bg-ink/5"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 [&>div]:min-h-0">{children}</div>
      </div>
    </dialog>
  );
}
