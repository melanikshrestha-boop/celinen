import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Download,
  FolderPlus,
  List,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Share,
  Trash2,
  PanelRight,
  Mail,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { chatShareFile, clientTranscript } from "@/lib/chat-sharing";
import type { ChatRecord, ChatSummary } from "@/lib/chat-history";
import { useChatHistory } from "./ChatHistory";
import { useWorkbench } from "./context";
import { useWorkspaceText } from "@/components/account/useWorkspaceText";
import { ArchiveUndo, HistoryRowActions } from "./HistoryRowActions";
import { stopRowAction } from "./row-action-event";
import { sidebarConversationTitle } from "./sidebar-presentation";
import "./chat-controls.css";

type Action = "rename" | "section" | "delete" | "share" | "adobe";
export function ChatRecents({
  archivedOnly = false,
  menuSide = "right",
}: {
  archivedOnly?: boolean;
  menuSide?: "right" | "bottom";
}) {
  const history = useChatHistory();
  const workbench = useWorkbench();
  const t = useWorkspaceText();
  const restoreFocus = useRef<HTMLElement | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const skipRenameBlur = useRef(false);
  const [archived, setArchived] = useState(archivedOnly);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [dialog, setDialog] = useState<{ action: Action; row: ChatSummary } | null>(null);
  const [text, setText] = useState("");
  const [shared, setShared] = useState<ChatRecord | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoArchive, setUndoArchive] = useState<ChatSummary | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const disabled =
    !history?.ready ||
    history.locked ||
    history.switching ||
    history.pending ||
    !!history.error ||
    busy;
  const run = async (task: () => Promise<unknown>) => {
    const request = generation.current;
    setBusy(true);
    setNote("");
    try {
      await task();
    } catch (error) {
      if (request === generation.current)
        setNote(
          error instanceof Error ? error.message : "Could not update this conversation. Try again.",
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const startRename = (row: ChatSummary) => {
    skipRenameBlur.current = false;
    setRenaming(row.id);
    setRenameText(row.title);
  };
  const commitRename = (row: ChatSummary) => {
    const next = renameText.trim();
    setRenaming(null);
    if (!history || !next || next === row.title) return;
    void run(() => history.rename(row.id, next));
  };
  const openDialog = (action: Action, row: ChatSummary) => {
    const rowButton = document.querySelector<HTMLElement>(
      `[data-chat-id="${row.id}"] [data-history-menu]`,
    );
    restoreFocus.current = rowButton?.getClientRects().length
      ? rowButton
      : (document.activeElement as HTMLElement);
    setText(action === "rename" ? row.title : row.section);
    setShared(null);
    setNote("");
    setDialog({ action, row });
    if (action === "share" && history) {
      const request = ++generation.current;
      void run(async () => {
        const record = await history.read(row.id);
        if (request === generation.current) setShared(record);
      });
    }
  };
  useEffect(() => {
    if (archivedOnly) return;
    const action = (event: Event) => {
      const detail = (event as CustomEvent<{ action: Action }>).detail;
      if (disabled || !history?.active) return;
      if (detail?.action === "rename") startRename(history.active);
      else if (["section", "delete", "share", "adobe"].includes(detail?.action))
        openDialog(detail.action, history.active);
    };
    window.addEventListener("lenslabs:chat-dialog", action);
    return () => window.removeEventListener("lenslabs:chat-dialog", action);
  });
  useEffect(() => {
    if (renaming) renameInput.current?.select();
  }, [renaming]);
  if (!history) return null;
  const sections = [...new Set(history.rows.map((row) => row.section).filter(Boolean))].sort();
  const visible = history.rows.filter(
    (row) => row.archived === (archivedOnly || archived) && (row.named || row.title !== "New chat"),
  );
  const groups =
    archivedOnly || archived
      ? [{ id: "archive", name: "Archived Shoots", rows: visible }]
      : [
          { id: "pinned", name: "Pinned", rows: visible.filter((row) => row.pinned) },
          ...sections.map((name) => ({
            id: `section:${name}`,
            name,
            rows: visible.filter((row) => !row.pinned && row.section === name),
          })),
          {
            id: "recent",
            name: "Recent Shoots",
            rows: visible.filter((row) => !row.pinned && !row.section),
          },
        ];
  const open = (row: ChatSummary, quick = false) =>
    run(async () => {
      if (await history.select(row.id)) {
        if (quick && workbench?.openQuickChat) await workbench.openQuickChat();
        else await workbench?.openTool("/workspace");
      }
    });
  const archiveRow = (row: ChatSummary) =>
    run(async () => {
      await history.archive(row.id, !row.archived);
      setUndoArchive(row.archived ? null : row);
    });
  return (
    <div className="ll-chat-recents">
      <div className="ll-chat-heading">
        <span>{t(archivedOnly || archived ? "Archived Shoots" : "Shoots")}</span>
        <div className="ll-chat-heading-actions">
          {!archivedOnly && (
            <button
              title={t("New Shoot")}
              aria-label={t("New Shoot")}
              data-history-new
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  if (await history.select()) await workbench?.openTool("/workspace");
                })
              }
            >
              <Plus size={15} />
            </button>
          )}
          {!archivedOnly && (
            <button
              title={t(archived ? "Show Recent Shoots" : "Show Archived Shoots")}
              aria-label={t(archived ? "Show Recent Shoots" : "Show Archived Shoots")}
              aria-pressed={archived}
              onClick={() => setArchived(!archived)}
            >
              <Archive size={15} />
            </button>
          )}
        </div>
      </div>
      {groups
        .filter((group) => group.rows.length)
        .map((group) => (
          <div key={group.id} className="ll-chat-group">
            {group.id !== "recent" && group.id !== "archive" && (
              <h3>{group.id.startsWith("section:") ? group.name : t(group.name)}</h3>
            )}
            {group.rows.map((row) => (
              <div
                key={row.id}
                className={`ll-chat-row history-row ${history.active?.id === row.id ? "is-active" : ""}`}
                data-chat-id={row.id}
              >
                {renaming === row.id ? (
                  <input
                    ref={renameInput}
                    className="ll-chat-title-input"
                    value={renameText}
                    maxLength={80}
                    aria-label="Shoot Name"
                    disabled={disabled}
                    onChange={(event) => setRenameText(event.target.value)}
                    onBlur={() => {
                      if (skipRenameBlur.current) {
                        skipRenameBlur.current = false;
                        return;
                      }
                      commitRename(row);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        (event.currentTarget as HTMLInputElement).blur();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        skipRenameBlur.current = true;
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    className="ll-chat-title"
                    title={sidebarConversationTitle(row)}
                    aria-current={history.active?.id === row.id ? "true" : undefined}
                    disabled={disabled}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      void open(row);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startRename(row);
                    }}
                  >
                    {row.unread && <i aria-label="Unread" />}
                    <span>{sidebarConversationTitle(row)}</span>
                  </button>
                )}
                <HistoryRowActions
                  title={sidebarConversationTitle(row)}
                  kind="chat"
                  pinned={row.pinned}
                  archived={row.archived}
                  disabled={disabled}
                  pin={() => void run(() => history.update(row.id, { pinned: !row.pinned }))}
                  archive={() => void archiveRow(row)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="ll-chat-hover"
                      aria-label={`More Options for ${sidebarConversationTitle(row)}`}
                      data-history-menu
                      disabled={disabled}
                      onPointerDown={stopRowAction}
                      onClick={stopRowAction}
                      onDoubleClick={stopRowAction}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="ll-chat-menu"
                    align={menuSide === "bottom" ? "end" : "start"}
                    side={menuSide}
                    collisionPadding={12}
                  >
                    <DropdownMenuItem onSelect={() => openDialog("share", row)}>
                      <Share />
                      {t("Share with Client…")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => startRename(row)}>
                      <Pencil />
                      {t("Rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(() => history.update(row.id, { pinned: !row.pinned }))
                      }
                    >
                      <Pin />
                      {t(row.pinned ? "Unpin" : "Pin")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void archiveRow(row)}>
                      <Archive />
                      {t(row.archived ? "Restore Shoot" : "Archive")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openDialog("delete", row)}>
                      <Trash2 />
                      {t("Delete Shoot…")}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <List />
                        {t("Section")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent className="ll-chat-menu">
                          <DropdownMenuItem onSelect={() => openDialog("section", row)}>
                            <FolderPlus />
                            {t("New Section…")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              void run(() => history.update(row.id, { section: "", pinned: false }))
                            }
                          >
                            {t("Recent Shoots")}
                          </DropdownMenuItem>
                          {sections.map((section) => (
                            <DropdownMenuItem
                              key={section}
                              onSelect={() =>
                                void run(() => history.update(row.id, { section, pinned: false }))
                              }
                            >
                              {section}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                    <DropdownMenuItem onSelect={() => void open(row, true)}>
                      <PanelRight />
                      {t("Open in Side Panel")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(() => history.update(row.id, { unread: !row.unread }))
                      }
                    >
                      <Mail />
                      {t(row.unread ? "Mark as Read" : "Mark as Unread")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openDialog("adobe", row)}>
                      <Download />
                      {t("Adobe Export…")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ))}
      {!visible.length && (archivedOnly || archived) && (
        <p className="ll-chat-empty">No archived shoots.</p>
      )}
      {undoArchive && (
        <ArchiveUndo
          title={sidebarConversationTitle(undoArchive)}
          disabled={disabled}
          undo={() =>
            void run(async () => {
              await history.archive(undoArchive.id, false);
              setUndoArchive(null);
            })
          }
        />
      )}
      {note && !dialog && (
        <p role="alert" className="ll-chat-note">
          {note}
        </p>
      )}
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && (!busy || dialog?.action === "share")) {
            generation.current++;
            setDialog(null);
            setShared(null);
            setNote("");
            setBusy(false);
          }
        }}
      >
        <DialogContent
          className="ll-chat-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = restoreFocus.current;
            if (target?.isConnected && target.getClientRects().length) target.focus();
            else document.querySelector<HTMLElement>("[data-history-new]")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog?.action === "adobe"
                ? "Export this shoot to Adobe"
                : dialog?.action === "share"
                  ? "Share with a client"
                  : dialog?.action === "delete"
                    ? "Delete This Shoot?"
                    : dialog?.action === "section"
                      ? "New Section"
                      : "Rename Shoot"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.action === "adobe"
                ? "Download the current shoot’s ratings and supported edits as XMP sidecars in one ZIP. Extract separately, back up existing XMP, then read metadata in Lightroom or Adobe Camera Raw. Original photos and chat text are not exported. This browser cannot launch Adobe or Finder directly."
                : dialog?.action === "delete"
                  ? `The conversation “${dialog.row.title}” will be permanently deleted. Your project, photos and edits stay untouched. Archive instead if you may need it later.`
                  : dialog?.action === "share"
                    ? "Review the snapshot below. It includes conversation text, not private connector requests, tool details, unsent drafts or photos. Nothing is published automatically."
                    : dialog?.action === "section"
                      ? "Organize these conversations into sections. Empty sections disappear automatically."
                      : "Choose a name you can find again."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.action === "adobe" && (
            <button
              className="settings-button"
              disabled={disabled}
              onClick={() => {
                let handled = false;
                window.dispatchEvent(
                  new CustomEvent("lenslabs:export-adobe", {
                    detail: {
                      project: dialog.row.project,
                      respond: (result: string) => {
                        handled = true;
                        setNote(result);
                      },
                    },
                  }),
                );
                if (!handled)
                  setNote(
                    "Open Studio for this shoot and wait for its photos to load, then try again.",
                  );
              }}
            >
              <Download size={15} />
              Download Adobe sidecars
            </button>
          )}
          {(dialog?.action === "rename" || dialog?.action === "section") && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!text.trim() || disabled) return;
                void run(async () => {
                  if (dialog.action === "rename") await history.rename(dialog.row.id, text.trim());
                  else await history.update(dialog.row.id, { section: text.trim(), pinned: false });
                  setDialog(null);
                });
              }}
            >
              <label>
                {dialog.action === "section" ? "Section name" : "Chat name"}
                <input
                  autoFocus
                  value={text}
                  maxLength={dialog.action === "section" ? 60 : 80}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <button className="settings-button" disabled={!text.trim() || disabled} type="submit">
                Save
              </button>
            </form>
          )}
          {dialog?.action === "delete" && (
            <div className="ll-chat-dialog-actions">
              <button className="settings-button" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className="settings-button ll-chat-delete"
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    await history.remove(dialog.row.id);
                    setDialog(null);
                  })
                }
              >
                Delete Shoot
              </button>
            </div>
          )}
          {dialog?.action === "share" && (
            <>
              <div className="ll-transcript-preview" aria-label="Client transcript preview">
                {shared ? (
                  <>
                    <h3>{shared.title}</h3>
                    {clientTranscript(shared).messages.map((message, index) => (
                      <article key={index}>
                        <strong>{message.role === "user" ? "Photographer" : "LensLabs"}</strong>
                        <p>{message.text}</p>
                      </article>
                    ))}
                    {!clientTranscript(shared).messages.length && <p>No shareable messages yet.</p>}
                  </>
                ) : (
                  <p>Preparing preview…</p>
                )}
              </div>
              <div className="ll-chat-dialog-actions">
                <button
                  className="settings-button"
                  disabled={!shared || busy || !clientTranscript(shared).messages.length}
                  onClick={() => {
                    if (!shared) return;
                    const file = chatShareFile(shared);
                    const url = URL.createObjectURL(file);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = file.name;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                    setNote(
                      "Transcript downloaded. Attach the HTML file to your client message; it opens in a browser.",
                    );
                  }}
                >
                  <Download size={15} />
                  Download transcript
                </button>
                {typeof navigator !== "undefined" && !!navigator.share && (
                  <button
                    className="settings-button"
                    disabled={!shared || busy || !clientTranscript(shared).messages.length}
                    onClick={() =>
                      void run(async () => {
                        if (!shared) return;
                        const file = chatShareFile(shared);
                        if (!navigator.canShare?.({ files: [file] }))
                          throw new Error(
                            "File sharing isn't supported here. Download the transcript and attach it instead.",
                          );
                        try {
                          const request = generation.current;
                          await navigator.share({ files: [file], title: shared.title });
                          if (request === generation.current)
                            setNote("Shared through your device.");
                        } catch (error) {
                          if (!(error instanceof Error && error.name === "AbortError")) throw error;
                        }
                      })
                    }
                  >
                    <Share size={15} />
                    Share file…
                  </button>
                )}
              </div>
              <p className="ll-chat-empty">
                A downloaded copy cannot be revoked. Review client details before sharing.
              </p>
            </>
          )}
          {note && (
            <p role="status" className="ll-chat-note">
              {note}
            </p>
          )}
          {busy && <p role="status">Working…</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
