import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Mail, Search } from "lucide-react";
import type { MailMessage } from "@/lib/connections/gmail";
import { useGmail } from "./GmailConnection";
import { useWorkbench } from "./context";
import { workspaceToolHref, workspaceToolText } from "@/lib/workbench-projects";

export function MailPanel({
  href,
  requested,
  onRequestConsumed,
}: {
  href: string;
  requested?: string | undefined;
  onRequestConsumed?: (href: string) => void;
}) {
  const { session, status, configured, ready, connect, disconnect } = useGmail();
  const workbench = useWorkbench();
  const params = new URL(href, "https://workspace.invalid").searchParams;
  const selected = params.has("message") ? (workspaceToolText(href, "message") ?? "") : null;
  const [query, setQuery] = useState(workspaceToolText(href, "q") ?? "");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [searched, setSearched] = useState(false);
  const [nextPage, setNextPage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useRef(0),
    controller = useRef<AbortController | null>(null),
    requestedRun = useRef(false);
  useEffect(() => {
    if (requested) setQuery(requested);
  }, [requested]);
  useEffect(() => {
    run.current++;
    controller.current?.abort();
    setMessages([]);
    setMessage(null);
    setSearched(false);
    setBusy(false);
    setNextPage("");
    setError("");
    workbench?.setToolTitle(href, selected !== null ? "Gmail · Message" : "Gmail");
    // Clear message subjects from the tab strip on every mailbox transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.email, status.state, href]);
  useEffect(
    () => () => {
      run.current++;
      controller.current?.abort();
    },
    [],
  );
  const load = async (page = "", term = query) => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const current = ++run.current,
      generation = session.generation;
    setBusy(true);
    setError("");
    if (selected === null && !page) {
      setMessages([]);
      setNextPage("");
      setSearched(false);
      setSearchTerm("");
    }
    try {
      if (selected !== null) {
        const detail = await session.read(selected, active.signal);
        if (current === run.current && generation === session.generation) {
          setMessage(detail);
          workbench?.setToolTitle(href, `Gmail · ${detail.subject}`);
        }
      } else {
        const response = await session.search(term, page, active.signal);
        if (current !== run.current || generation !== session.generation) return;
        setMessages((old) =>
          page
            ? [
                ...old,
                ...response.messages.filter((item) => !old.some((prior) => prior.id === item.id)),
              ]
            : response.messages,
        );
        setNextPage(response.nextPageToken);
        setSearched(true);
        setSearchTerm(term);
        workbench?.setToolTitle(href, term ? `Gmail · ${term}` : "Gmail · Inbox");
      }
    } catch (cause) {
      if (current === run.current && !active.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Gmail could not load.");
    } finally {
      if (current === run.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!requested || requestedRun.current || status.state !== "connected") return;
    requestedRun.current = true;
    onRequestConsumed?.(href);
    void load("", requested);
    // Only an explicit chat request starts this search, never restoring an old URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, status.state, href, onRequestConsumed]);
  return (
    <div className="workspace-connection-pane">
      <header>
        <h1>
          <Mail size={19} /> Gmail
        </h1>
        <span>{status.email ?? "Not connected"}</span>
      </header>
      {status.state !== "connected" ? (
        <div className="workspace-setup-note">
          <h2>Your client conversations, beside your shoot.</h2>
          <p>
            Connect Gmail to search and read messages. No sending, deleting, attachments, or mailbox
            uploads to the assistant.
          </p>
          {!configured && (
            <p>
              Setup needed: enable Gmail API and add the public Gmail OAuth client ID in Celinen
              hosting settings.
            </p>
          )}
          <button
            className="workspace-connect-button"
            onClick={connect}
            disabled={!configured || !ready || status.state === "connecting"}
          >
            {status.state === "connecting"
              ? "Waiting for Google…"
              : configured && !ready
                ? status.note
                  ? "Connection unavailable"
                  : "Loading Google…"
                : "Connect Gmail"}
          </button>
          <a href="https://mail.google.com/" target="_blank" rel="noopener noreferrer">
            Open Gmail <ArrowUpRight size={14} />
          </a>
          {query && <p>Search ready: {query}</p>}
        </div>
      ) : (
        <>
          <div className="workspace-mail-account">
            <span>Read-only · session connection</span>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect Gmail and revoke the permissions granted to this Gmail integration?",
                  )
                )
                  void disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
          {selected !== null ? (
            <>
              <button
                className="workspace-connect-button"
                onClick={() => void load()}
                disabled={busy}
              >
                {busy ? "Reading…" : message ? "Refresh message" : "Read message"}
              </button>
              {message && (
                <article className="workspace-mail-message">
                  <h2>{message.subject}</h2>
                  <p>{message.from}</p>
                  <span>{message.date}</span>
                  <pre>{message.text}</pre>
                  <a
                    href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(status.email ?? "")}#all/${message.threadId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open original in Gmail <ArrowUpRight size={14} />
                  </a>
                </article>
              )}
            </>
          ) : (
            <>
              <form
                className="workspace-search-line"
                onSubmit={(event) => {
                  event.preventDefault();
                  void load();
                }}
              >
                <Search size={17} />
                <input
                  aria-label="Search Gmail"
                  placeholder="Client name, subject, or from:…"
                  value={query}
                  maxLength={500}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button disabled={busy}>{busy ? "Searching…" : "Search"}</button>
              </form>
              {searched && (
                <p className="workspace-result-caption">
                  {searchTerm ? `Messages for “${searchTerm}”` : "Recent messages"}
                </p>
              )}
              <div className="workspace-mail-list">
                {messages.map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      void workbench?.openTool(
                        workspaceToolHref("/mail", "", {
                          message: item.id,
                          tab: crypto.randomUUID(),
                        }),
                      )
                    }
                  >
                    <span>{item.from}</span>
                    <strong>{item.subject}</strong>
                    <p>{item.snippet}</p>
                  </button>
                ))}
              </div>
              {searched && !messages.length && <p>No messages match this search.</p>}
              {nextPage && (
                <button disabled={busy} onClick={() => void load(nextPage, searchTerm)}>
                  Load more
                </button>
              )}
            </>
          )}
        </>
      )}
      {status.note && (
        <p role="status" className="workspace-connection-hint">
          {status.note}
        </p>
      )}
      {error && (
        <p role="alert" className="workspace-connection-error">
          {error}
        </p>
      )}
    </div>
  );
}
