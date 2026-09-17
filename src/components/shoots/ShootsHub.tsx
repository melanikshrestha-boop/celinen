import { useState, type MouseEvent, type ReactNode } from "react";
import { Archive, ArrowUpRight, Camera, Search } from "lucide-react";
import { useWorkbench } from "@/components/workbench/context";
import { RecentShoots } from "@/components/workbench/RecentShoots";
import { ArchiveUndo, HistoryRowActions } from "@/components/workbench/HistoryRowActions";
import { useShootRowActions } from "@/components/workbench/useShootRowActions";
import {
  shootWorkspaceHref,
  shootSummaryDetail,
  shootsInNext24Hours,
  useShootNavigationData,
  type ShootSummary,
} from "./navigation";
import "./shoots.css";

export function ShootLink({
  href,
  children,
  className,
  current,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  current?: boolean;
}) {
  const workbench = useWorkbench();
  const [error, setError] = useState("");
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !workbench ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    setError("");
    void workbench
      .openTool(href)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "This page could not open."),
      );
  };
  return (
    <>
      <a
        className={className}
        href={href}
        onClick={open}
        aria-current={current ? "page" : undefined}
      >
        {children}
      </a>
      {error && (
        <span className="shoots-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

function ShootRows({
  rows,
  actions,
}: {
  rows: readonly ShootSummary[];
  actions: ReturnType<typeof useShootRowActions>;
}) {
  return (
    <>
      <ul className="shoots-list">
        {rows.map((row) => (
          <li key={row.key} className="history-row shoots-organized-row" data-shoot-key={row.key}>
            <ShootLink
              href={row.recoveryPending ? "/library" : shootWorkspaceHref(row.key)}
              className="shoots-list-row"
            >
              <Camera size={19} strokeWidth={1.6} aria-hidden="true" />
              <span className="shoots-list-identity">
                <strong>{row.title}</strong>
                <small>
                  {shootSummaryDetail(row)}
                  {row.recoveryPending && " · Recovery unfinished"}
                </small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </ShootLink>
            <HistoryRowActions
              title={row.title}
              kind={row.kind === "project" ? "album" : "shoot"}
              pinned={Boolean(row.pinned)}
              archived={Boolean(row.archived)}
              disabled={actions.busy}
              pin={() => void actions.pin(row)}
              archive={() => void actions.archive(row)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

export function ShootsHub({
  scope,
  view,
  includeLocalProjects,
}: {
  scope: string;
  view: "tonight" | "shoots" | "library";
  includeLocalProjects: boolean;
}) {
  const data = useShootNavigationData(scope, includeLocalProjects);
  const actions = useShootRowActions(scope);
  const workbench = useWorkbench();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const titles = { tonight: "Tonight", shoots: "Shoots", library: "Library" };
  const open = async (href: string) => {
    if (workbench) return workbench.openTool(href);
    window.location.assign(href);
    return true;
  };
  const directoryRows = data.rows.filter(
    (row) => Boolean(row.archived) === (view === "tonight" ? false : archived),
  );
  const rows = (view === "tonight" ? shootsInNext24Hours(directoryRows) : directoryRows).filter(
    (row) =>
      `${row.title} ${row.genre ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  return (
    <section className={`shoots-hub shoots-hub-${view}`} aria-labelledby="shoots-hub-title">
      <header className="shoots-hub-header">
        <div>
          <h1 id="shoots-hub-title">{titles[view]}</h1>
          <p>
            {view === "tonight"
              ? "Games in the next 24 hours."
              : view === "library"
                ? "Your saved shoots and albums."
                : "Open a shoot to cull, develop, and deliver."}
          </p>
        </div>
        {view !== "tonight" && (
          <button
            type="button"
            className="shoots-archive-toggle"
            aria-pressed={archived}
            onClick={() => setArchived((value) => !value)}
          >
            <Archive size={16} aria-hidden="true" />
            {archived ? "Show active" : "Archived"}
          </button>
        )}
        {view === "shoots" && data.rows.length > 0 && (
          <label className="shoots-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a shoot"
              aria-label="Find a shoot"
            />
          </label>
        )}
      </header>
      {data.error && (
        <div className="shoots-error" role="alert">
          <p>{data.error}</p>
          <button onClick={() => void data.refresh()}>Retry reading shoots</button>
        </div>
      )}
      {data.loading && !data.rows.length && (
        <p className="shoots-quiet" role="status">
          Opening saved shoots…
        </p>
      )}
      {view === "library" ? (
        <div className="shoots-library">
          <RecentShoots
            key={scope}
            scope={scope}
            activeId={null}
            open={open}
            hrefForShoot={shootWorkspaceHref}
            heading={archived ? "Archived shoots" : "Saved shoots"}
            showMetadata
            archivedOnly={archived}
          />
          {directoryRows.some((row) => row.kind === "project") && (
            <section aria-label="Saved albums">
              <h2>{archived ? "Archived albums" : "Saved albums"}</h2>
              <ShootRows
                actions={actions}
                rows={directoryRows.filter((row) => row.kind === "project")}
              />
            </section>
          )}
          {!data.loading && !data.error && !data.rows.length && (
            <div className="shoots-empty">
              <p>No saved shoots yet.</p>
              <button
                type="button"
                className="shoots-primary-link"
                onClick={() => void (workbench?.newShoot ? workbench.newShoot() : open("/studio"))}
              >
                New shoot
              </button>
            </div>
          )}
        </div>
      ) : rows.length > 0 ? (
        <ShootRows actions={actions} rows={rows} />
      ) : (
        !data.loading &&
        !data.error && (
          <div className="shoots-empty">
            <h2>
              {view === "tonight"
                ? data.scheduleKnown
                  ? "No shoots in the next 24 hours"
                  : "Kickoff times aren’t saved yet"
                : archived
                  ? "No archived shoots"
                  : query
                    ? "No matching shoots"
                    : "Your next shoot starts here"}
            </h2>
            <p>
              {view === "tonight"
                ? data.scheduleKnown
                  ? "Your other shoots are still in the library."
                  : "Your saved albums do not include game schedules. Updated dates are not kickoff times."
                : query
                  ? "Try another name."
                  : "Import photos. Your existing originals and edits stay in their current libraries."}
            </p>
            {!query && view !== "tonight" && (
              <button
                type="button"
                className="shoots-primary-link"
                onClick={() => void (workbench?.newShoot ? workbench.newShoot() : open("/studio"))}
              >
                New shoot
              </button>
            )}
            {view === "tonight" && (
              <ShootLink href="/shoots" className="shoots-text-link">
                Open shoots <ArrowUpRight size={15} />
              </ShootLink>
            )}
          </div>
        )
      )}
      {actions.archived && (
        <ArchiveUndo
          title={actions.archived.title}
          disabled={actions.busy}
          undo={() => void actions.undo()}
        />
      )}
      {actions.error && (
        <p role="alert" className="shoots-error">
          {actions.error}
        </p>
      )}
    </section>
  );
}
