import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { externalSearchHref, type WebResult } from "@/lib/connections/research";
import { searchWorkspaceWeb, webSearchReadiness } from "@/lib/connections/research.functions";
import { useWorkbench } from "./context";
import { workspaceToolText } from "@/lib/workbench-projects";

export function ResearchPanel({
  href,
  requested,
  onRequestConsumed,
}: {
  href: string;
  requested?: string | undefined;
  onRequestConsumed?: (href: string) => void;
}) {
  const setToolTitle = useWorkbench()?.setToolTitle;
  const initial = workspaceToolText(href, "q") ?? "";
  const [query, setQuery] = useState(initial);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [results, setResults] = useState<WebResult[] | null>(null);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0),
    alive = useRef(true),
    requestedRun = useRef(false);
  useEffect(() => {
    const requestRun = run;
    alive.current = true;
    void webSearchReadiness()
      .then((state) => {
        if (alive.current) setConfigured(state.configured);
      })
      .catch(() => {
        if (alive.current) {
          setConfigured(false);
          setError("Search setup could not be checked.");
        }
      });
    return () => {
      alive.current = false;
      requestRun.current++;
    };
  }, []);
  const search = useCallback(
    async (text: string) => {
      if (text.trim().length < 2) return;
      const current = ++run.current;
      setBusy(true);
      setError("");
      try {
        const response = await searchWorkspaceWeb({ data: { query: text.trim() } });
        if (!alive.current || run.current !== current) return;
        setResults(response.results);
        setReceipt(response.query);
        setToolTitle?.(href, `Web · ${response.query}`);
      } catch (error) {
        if (alive.current && run.current === current)
          setError(error instanceof Error ? error.message : "Web search could not finish.");
      } finally {
        if (alive.current && run.current === current) setBusy(false);
      }
    },
    [href, setToolTitle],
  );
  useEffect(() => {
    if (!requested || requestedRun.current || configured === null) return;
    requestedRun.current = true;
    onRequestConsumed?.(href);
    if (configured) void search(requested);
  }, [requested, configured, search, onRequestConsumed, href]);
  return (
    <div className="workspace-connection-pane">
      <header>
        <h1>Web research</h1>
        <span>Sources, not guesses</span>
      </header>
      <form
        className="workspace-search-line"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
      >
        <Search size={17} />
        <input
          aria-label="Search the web"
          placeholder="Locations, lighting, references…"
          value={query}
          maxLength={500}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button disabled={!configured || query.trim().length < 2 || busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {configured === false && (
        <div className="workspace-setup-note">
          <p>In-app results need the search provider connected in hosting settings.</p>
          <p>You can still run this search in your browser.</p>
          {query.trim() && (
            <a href={externalSearchHref(query)} target="_blank" rel="noopener noreferrer">
              Search on the web <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="workspace-connection-error">
          {error}
          {configured && query.trim() && (
            <>
              {" "}
              <a href={externalSearchHref(query)} target="_blank" rel="noopener noreferrer">
                Search on the web ↗
              </a>
            </>
          )}
        </p>
      )}
      {receipt && (
        <p className="workspace-result-caption">Results for “{receipt}” · Brave Search</p>
      )}
      {results?.length === 0 && <p>No results. Try a different search.</p>}
      <div className="workspace-search-results">
        {results?.map((result) => (
          <article key={result.url}>
            <span>{result.domain}</span>
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {result.title}
              <ArrowUpRight size={15} />
            </a>
            <p>{result.description}</p>
          </article>
        ))}
      </div>
      {!results && configured && (
        <p className="workspace-connection-hint">
          Search for a reference or a location. Open any source in your browser; results are not
          sent to the photo assistant.
        </p>
      )}
    </div>
  );
}
