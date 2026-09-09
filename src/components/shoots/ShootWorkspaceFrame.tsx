import type { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { ArrowUpRight, Camera, MessageSquare } from "lucide-react";
import { ShootEarningsStrip } from "@/components/earnings/ShootEarningsStrip";
import { ShootLink } from "./ShootsHub";
import {
  SHOOT_TABS,
  SHOOT_TAB_LABELS,
  parseShootKey,
  shootAssistantHref,
  shootContextHref,
  shootPhotoCountLabel,
  shootUpdatedLabel,
  useShootNavigationData,
  type ShootTab,
} from "./navigation";
import "./shoots.css";

export function ShootWorkflowTabs({ id, active }: { id: string; active: ShootTab }) {
  const href = useLocation({ select: (location) => location.href });
  if (!parseShootKey(id)) return null;
  return (
    <nav className="shoot-workflow-tabs" aria-label="Shoot workflow">
      {SHOOT_TABS.map((tab) => (
        <ShootLink key={tab} href={shootContextHref(id, tab, href)} current={tab === active}>
          {SHOOT_TAB_LABELS[tab]}
        </ShootLink>
      ))}
    </nav>
  );
}

export function ShootWorkspaceFrame({
  scope,
  shootKey,
  tab,
  children,
  includeLocalProjects,
}: {
  scope: string;
  shootKey: string;
  tab: ShootTab;
  children?: ReactNode;
  includeLocalProjects: boolean;
}) {
  const href = useLocation({ select: (location) => location.href });
  const data = useShootNavigationData(scope, includeLocalProjects);
  const target = parseShootKey(shootKey);
  if (!target || (target.kind === "project" && !includeLocalProjects))
    return (
      <div className="shoots-empty" role="alert">
        <h1>This shoot link is unavailable</h1>
        <p>No other shoot was opened.</p>
        <ShootLink href="/library">Open Library</ShootLink>
      </div>
    );
  const row = data.rows.find((item) => item.key === shootKey);
  if (tab !== "overview")
    return <div className={`shoot-workspace-content shoot-workspace-${tab}`}>{children}</div>;
  return (
    <section className="shoots-hub shoot-overview" aria-labelledby="shoot-overview-title">
      <header className="shoots-hub-header">
        <div>
          <ShootLink href="/shoots" className="shoots-breadcrumb">
            Shoots
          </ShootLink>
          <h1 id="shoot-overview-title">{row?.title ?? "Shoot"}</h1>
          {row && (
            <p>
              {shootPhotoCountLabel(row.kind, row.photoCount) &&
                `${shootPhotoCountLabel(row.kind, row.photoCount)} · `}
              {shootUpdatedLabel(row.updatedAt)}
            </p>
          )}
        </div>
      </header>
      {data.error && (
        <p className="shoots-error" role="alert">
          {data.error}
        </p>
      )}
      {data.loading && (
        <p className="shoots-quiet" role="status">
          Reading shoot details…
        </p>
      )}
      {!data.loading && !data.error && !row && (
        <p className="shoots-quiet">
          This shoot does not have a saved directory entry yet. Its own photo library will open in
          Cull or Develop.
        </p>
      )}
      <div className="shoot-overview-actions">
        <ShootLink href={shootContextHref(shootKey, "cull", href)} className="shoots-primary-link">
          <Camera size={17} />
          Open Cull
          <ArrowUpRight size={16} />
        </ShootLink>
        <ShootLink href={shootAssistantHref(shootKey, href)} className="shoots-text-link">
          <MessageSquare size={17} />
          Open saved assistant
        </ShootLink>
      </div>
      <ShootEarningsStrip shootKey={shootKey} />
      <dl className="shoot-overview-details">
        <div>
          <dt>Stage</dt>
          <dd>Not recorded</dd>
        </div>
        <div>
          <dt>Kickoff</dt>
          <dd>Not recorded</dd>
        </div>
        <div>
          <dt>Heroes deadline</dt>
          <dd>Not recorded</dd>
        </div>
        <div>
          <dt>Gallery deadline</dt>
          <dd>Not recorded</dd>
        </div>
        <div>
          <dt>Organization / contact</dt>
          <dd>Not connected here</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>Open Cull to review your photos</dd>
        </div>
      </dl>
      <p className="shoots-quiet">
        Scheduling and booking fields are not connected to these albums yet. No stage, deadline, or
        payment has been inferred.
      </p>
    </section>
  );
}

export function ShootPlaceholder({ tab }: { tab: "social" | "smart-file" }) {
  return (
    <section className="shoots-hub">
      <header className="shoots-hub-header">
        <div>
          <h1>{SHOOT_TAB_LABELS[tab]}</h1>
          <p>
            {tab === "social"
              ? "Prepare the next share from this shoot."
              : "Keep booking paperwork with the shoot."}
          </p>
        </div>
      </header>
      <div className="shoots-empty">
        <h2>
          {tab === "social"
            ? "Shoot-to-social is not connected yet"
            : "SmartFile is not connected yet"}
        </h2>
        <p>
          {tab === "social"
            ? "Star-to-Story, X, and TikTok need a verified shoot handoff and destination permissions. No post has been created or sent."
            : "Proposals, contracts, e-signatures, and deposits are not a connected booking flow yet. Existing invoice drafts and recorded payments remain in Earnings."}
        </p>
        <ShootLink href={tab === "social" ? "/deliver" : "/earnings"} className="shoots-text-link">
          {tab === "social" ? "Open Deliver" : "Open Earnings"}
          <ArrowUpRight size={15} />
        </ShootLink>
      </div>
    </section>
  );
}
