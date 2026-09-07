import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Context,
} from "react";
import { useBlocker, defaultStringifySearch } from "@tanstack/react-router";
import { explicitWorkspaceBinding, projectScope } from "@/lib/workbench-projects";
import { isWorkbenchRoute } from "@/lib/workbench";
import {
  Archive,
  Camera,
  ArchiveRestore,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useWorkbench } from "./context";
import {
  chatSchema,
  chatTitle,
  localChatRepository,
  newChat,
  needsChatSave,
  storedMessages,
  type ChatMessage,
  type ChatRecord,
  type ChatRepository,
  type ChatSummary,
} from "@/lib/chat-history";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type History = {
  active: ChatRecord | null;
  rows: ChatSummary[];
  ready: boolean;
  pending: boolean;
  locked: boolean;
  switching: boolean;
  error: string;
  local: boolean;
  snapshot: (messages: ChatMessage[], draft: string) => void;
  setLocked: (value: boolean) => void;
  select: (id?: string) => Promise<boolean>;
  rename: (id: string, title: string) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  exportChat: () => void;
  retry: () => void;
};
const HistoryContext =
  (import.meta.hot?.data["historyContext"] as Context<History | null> | undefined) ??
  createContext<History | null>(null);
if (import.meta.hot) import.meta.hot.data["historyContext"] = HistoryContext;
// eslint-disable-next-line react-refresh/only-export-components
export const useChatHistory = () => useContext(HistoryContext);

export function ChatHistoryProvider({
  scope,
  project,
  children,
}: {
  scope: string;
  project: string;
  children: ReactNode;
}) {
  // Keyed by the workspace binding, not by the conversation. Studio never remounts for New chat.
  return (
    <HistorySession key={`${scope}:${project}`} scope={scope} project={project}>
      {children}
    </HistorySession>
  );
}
function HistorySession({
  scope,
  project,
  children,
}: {
  scope: string;
  project: string;
  children: ReactNode;
}) {
  const account = useAccount();
  const registerLeaveGuard = account?.registerLeaveGuard;
  const local = scope === "device-local";
  const repository = useMemo<ChatRepository>(
    () =>
      local
        ? localChatRepository(scope)
        : {
            list: async (project) =>
              (await import("@/lib/chat-history.functions")).listWorkspaceChats({
                data: { project, expectedOwner: scope },
              }),
            read: async (id) =>
              (await import("@/lib/chat-history.functions")).readWorkspaceChat({
                data: { id, expectedOwner: scope },
              }),
            save: async (record) =>
              (await import("@/lib/chat-history.functions")).saveWorkspaceChat({
                data: { record: { ...record, draft: "" }, expectedOwner: scope },
              }),
          },
    [scope, local],
  );
  const [active, setActive] = useState<ChatRecord | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [rows, setRows] = useState<ChatSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const transition = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const failure = useRef("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const revisions = useRef(new Map<string, number>());
  const drafts = useRef(new Map<string, string>());
  const metadataPending = useRef(new Set<string>());
  const alive = useRef(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setReady(false);
    setError("");
    failure.current = "";
    void repository
      .list(project)
      .then(async (list) => {
        const recent = list.find((row) => !row.archived);
        const record = recent ? await repository.read(recent.id) : newChat(project);
        if (cancelled) return;
        if (record.project !== project)
          throw new Error("This conversation belongs to another shoot.");
        setRows(list);
        revisions.current.set(record.id, record.revision);
        activeRef.current = record;
        setActive(record);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Chat history could not be loaded.";
          failure.current = message;
          setError(message);
        }
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [repository, project, attempt]);
  const persist = useCallback(
    (record: ChatRecord) => {
      if (failure.current) return Promise.reject(new Error(failure.current));
      setPending(true);
      const task = queue.current.then(async () => {
        if (!alive.current) throw new Error("Workspace closed before this chat could be saved.");
        if (failure.current) throw new Error(failure.current);
        const saved = await repository.save({
          ...record,
          revision: revisions.current.get(record.id) ?? record.revision,
        });
        revisions.current.set(saved.id, saved.revision);
        if (alive.current)
          setRows((rows) =>
            [saved, ...rows.filter((row) => row.id !== saved.id)].sort(
              (a, b) => b.updatedAt - a.updatedAt,
            ),
          );
      });
      const settled = task.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Chat could not be saved.";
        failure.current = message;
        if (alive.current) setError(message);
      });
      queue.current = settled;
      void settled.then(() => {
        if (queue.current === settled && alive.current) setPending(false);
      });
      return task;
    },
    [repository],
  );
  const snapshot = useCallback(
    (messages: ChatMessage[], draft: string) => {
      const current = activeRef.current;
      if (!current) return;
      if (!local) drafts.current.set(current.id, draft);
      let safe: ChatMessage[];
      try {
        safe = storedMessages(messages);
      } catch {
        const message =
          "This conversation exceeds the saved-message limit. Export it before starting another.";
        failure.current = message;
        setError(message);
        activeRef.current = { ...current, messages, draft };
        setActive(activeRef.current);
        return;
      }
      const sameMessages = JSON.stringify(safe) === JSON.stringify(current.messages);
      if (sameMessages && draft === current.draft) return;
      const next = {
        ...current,
        messages: safe,
        draft,
        title: current.named ? current.title : chatTitle(safe),
        updatedAt: Date.now(),
      };
      activeRef.current = next;
      setActive(next);
      if (
        !failure.current &&
        needsChatSave(
          local,
          !sameMessages,
          revisions.current.get(next.id) ?? 0,
          metadataPending.current.has(next.id),
          draft,
        )
      ) {
        metadataPending.current.add(next.id);
        void persist(local ? next : { ...next, draft: "" })
          .catch(() => undefined)
          .finally(() => metadataPending.current.delete(next.id));
      }
    },
    [persist, local],
  );
  const flush = useCallback(async () => {
    if (lockedRef.current)
      throw new Error(
        "Finish the assistant response or review its preview before switching chats or signing out.",
      );
    await queue.current;
    if (failure.current) throw new Error(failure.current);
  }, []);
  useBlocker({
    shouldBlockFn: async ({ next }) => {
      const binding = explicitWorkspaceBinding(
        `${next.pathname}${defaultStringifySearch(next.search)}`,
        false,
      );
      if (isWorkbenchRoute([next.routeId]) && (!binding || projectScope(binding) === project))
        return false;
      try {
        const before = activeRef.current;
        await flush();
        if (before !== activeRef.current) return true;
        return (
          !local &&
          [...drafts.current.values()].some((draft) => draft.trim()) &&
          !window.confirm(
            "Unsent drafts stay in this shoot’s current tab. Switch shoots and discard those drafts? Cancel to keep or export them.",
          )
        );
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Save the current conversation before leaving.",
        );
        return true;
      }
    },
    enableBeforeUnload: () =>
      Boolean(
        failure.current ||
        lockedRef.current ||
        [...drafts.current.values()].some((draft) => draft.trim()),
      ),
  });
  useEffect(
    () =>
      registerLeaveGuard?.(async () => {
        await flush();
        if (
          !local &&
          [...drafts.current.values()].some((draft) => draft.trim()) &&
          !window.confirm(
            "Unsent chat drafts stay in this tab and are not saved to your account. Log out and discard those drafts? Cancel to keep or export them.",
          )
        )
          return false;
        return true;
      }),
    [registerLeaveGuard, flush, local],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (failure.current || lockedRef.current || pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  const select = useCallback(
    async (id?: string) => {
      if (transition.current) return false;
      transition.current = true;
      setSwitching(true);
      const before = activeRef.current;
      try {
        await flush();
        const next = id ? await repository.read(id) : newChat(project);
        if (!local) next.draft = drafts.current.get(next.id) ?? "";
        if (!alive.current || activeRef.current !== before)
          throw new Error("Your conversation changed while opening another. Try again.");
        await flush();
        if (next.project !== project)
          throw new Error("Open the matching shoot before reading this conversation.");
        revisions.current.set(next.id, next.revision);
        activeRef.current = next;
        setActive(next);
        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message : "Chat could not be opened.");
        return false;
      } finally {
        transition.current = false;
        if (alive.current) setSwitching(false);
      }
    },
    [flush, repository, project, local],
  );
  const change = useCallback(
    async (id: string, patch: Partial<Pick<ChatRecord, "title" | "named" | "archived">>) => {
      if (transition.current) throw new Error("Wait for the current chat change.");
      transition.current = true;
      setSwitching(true);
      try {
        await flush();
        const record = activeRef.current?.id === id ? activeRef.current : await repository.read(id);
        if (record.project !== project) throw new Error("Wrong shoot.");
        revisions.current.set(record.id, revisions.current.get(record.id) ?? record.revision);
        const next = chatSchema.parse({ ...record, ...patch, updatedAt: Date.now() });
        await persist(next);
        if (activeRef.current?.id === id) {
          const value = patch.archived ? newChat(project) : next;
          activeRef.current = value;
          setActive(value);
        }
      } finally {
        transition.current = false;
        if (alive.current) setSwitching(false);
      }
    },
    [flush, repository, project, persist],
  );
  const exportChat = useCallback(() => {
    const record = activeRef.current;
    if (!record) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...record,
            exportedAt: new Date().toISOString(),
            messages: record.messages.map((message) =>
              message.privateConnector
                ? { role: message.role, text: "Private connection request", privateConnector: true }
                : message,
            ),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lenslabs-chat-${record.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, []);
  const lock = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);
  const value: History = {
    active,
    rows,
    ready,
    pending,
    locked,
    switching,
    error,
    local,
    snapshot,
    setLocked: lock,
    select,
    rename: (id, title) => change(id, { title, named: true }),
    archive: (id, archived) => change(id, { archived }),
    exportChat,
    retry: () => {
      if (!ready) setAttempt((value) => value + 1);
    },
  };
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function NewChatButton({
  camera = false,
  active = false,
}: {
  camera?: boolean;
  active?: boolean;
}) {
  const history = useChatHistory();
  const workbench = useWorkbench();
  return (
    <button
      className={`workbench-nav-item ${active ? "is-active" : ""}`}
      disabled={
        !camera &&
        (!history?.ready ||
          history.locked ||
          history.switching ||
          history.pending ||
          !!history.error)
      }
      onClick={() => {
        if (camera) void workbench?.openTool("/workspace");
        else if (workbench?.newShoot) void workbench.newShoot();
        else void history?.select();
      }}
    >
      {camera ? <Camera size={17} /> : <Plus size={17} />}
      {camera ? "Chat" : "New chat"}
    </button>
  );
}
export function ChatRecents() {
  const history = useChatHistory();
  const workbench = useWorkbench();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [archived, setArchived] = useState(false);
  const [rename, setRename] = useState<ChatSummary | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  if (!history) return null;
  const rows = history.rows.filter(
    (row) =>
      row.archived === archived &&
      row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const disabled =
    !history.ready || history.locked || history.switching || history.pending || !!history.error;
  return (
    <section className="chat-recents" aria-label="Chat history">
      <div className="chat-recents-heading">
        <span>{archived ? "Archived chats" : "Recent chats"}</span>
        <button aria-label="Search chats" onClick={() => setSearching(!searching)}>
          <Search size={14} />
        </button>
        <button
          aria-label={archived ? "Show recent chats" : "Show archived chats"}
          onClick={() => setArchived(!archived)}
        >
          <Archive size={14} />
        </button>
      </div>
      {searching && (
        <input
          aria-label="Search chat titles"
          placeholder="Search chats…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      )}
      {!history.ready && <p>{history.error ? "History unavailable" : "Opening history…"}</p>}
      {history.ready && !rows.length && (
        <p>
          {query
            ? "No matching chats"
            : archived
              ? "No archived chats"
              : "Your conversations will appear here."}
        </p>
      )}
      {rows.map((row) => (
        <div
          className={`chat-recent ${history.active?.id === row.id ? "is-active" : ""}`}
          key={row.id}
        >
          <button
            disabled={disabled || archived}
            aria-current={history.active?.id === row.id ? "true" : undefined}
            title={row.title}
            onClick={() => {
              void history.select(row.id).then((opened) => {
                if (opened) void workbench?.openTool("/workspace");
              });
            }}
          >
            {row.title}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button disabled={disabled} aria-label={`Options for ${row.title}`}>
                <MoreHorizontal size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  setRename(row);
                  setTitle(row.title);
                  setNote("");
                }}
              >
                <Pencil size={14} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void history
                    .archive(row.id, !row.archived)
                    .catch((error: unknown) =>
                      setNote(error instanceof Error ? error.message : "Couldn't update chat."),
                    );
                }}
              >
                {row.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                {row.archived ? "Restore" : "Archive"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {note && <p role="alert">{note}</p>}
      <Dialog
        open={!!rename}
        onOpenChange={(open) => {
          if (!open) setRename(null);
        }}
      >
        <DialogContent className="account-confirm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>
              Only the conversation name changes. Your shoot stays untouched.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (rename && title.trim())
                void history
                  .rename(rename.id, title.trim())
                  .then(() => setRename(null))
                  .catch((error: unknown) =>
                    setNote(error instanceof Error ? error.message : "Rename failed."),
                  );
            }}
          >
            <input
              aria-label="Chat title"
              maxLength={80}
              className="chat-rename-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button className="settings-button primary" disabled={!title.trim()}>
              Save name
            </button>
            {note && <p role="alert">{note}</p>}
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function ChatSaveStatus() {
  const history = useChatHistory();
  if (!history) return null;
  return (
    <div className="chat-save-status" role="status">
      {history.error ? (
        <>
          <span>{history.error}</span>
          {history.ready ? (
            <button onClick={history.exportChat}>
              <Download size={13} />
              Export chat
            </button>
          ) : (
            <button onClick={history.retry}>Retry</button>
          )}
        </>
      ) : (
        <>
          <span>
            {history.pending
              ? "Saving chat…"
              : !history.local && history.active?.draft
                ? "Draft stays in this tab"
                : history.active && (history.active.messages.length || history.active.draft)
                  ? history.local
                    ? "Saved on this device"
                    : "Saved to your account"
                  : history.local
                    ? "On this device"
                    : "Private chat"}
          </span>
          {history.active?.messages.length ? (
            <button
              aria-label="Export conversation"
              title="Export conversation"
              onClick={history.exportChat}
            >
              <Download size={13} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
