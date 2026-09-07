import { useEffect, useRef } from "react";
import { Camera, Plus, X } from "lucide-react";
import type { WorkbenchTab } from "@/lib/workbench";

/** Navigation tabs share one shoot controller; closing a tool never clears the shoot. */
export function ShootTabs({
  tabs,
  currentHref,
  chatHref,
  titles,
  onOpen,
  onClose,
  onNew,
}: {
  tabs: WorkbenchTab[];
  currentHref: string | null;
  chatHref: string;
  titles: Record<string, string>;
  onOpen: (href: string) => Promise<boolean>;
  onClose: (tab: WorkbenchTab) => Promise<boolean>;
  onNew: () => void;
}) {
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentHref]);
  const link = (href: string, label: React.ReactNode, selected: boolean) => (
    <a
      href={href}
      ref={selected ? active : undefined}
      aria-current={selected ? "page" : undefined}
      onClick={(event) => {
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          event.preventDefault();
          void onOpen(href);
        }
      }}
    >
      {label}
    </a>
  );
  return (
    <nav className="workbench-tabs" aria-label="Tabs in this shoot">
      <div className={`workbench-tab ${!currentHref ? "is-active" : ""}`}>
        {link(
          chatHref,
          <>
            <Camera size={15} aria-hidden="true" />
            Chat
          </>,
          !currentHref,
        )}
      </div>
      {tabs.map((tab) => (
        <div
          className={`workbench-tab ${currentHref === tab.href ? "is-active" : ""}`}
          key={tab.href}
        >
          {link(tab.href, titles[tab.href] ?? tab.label, currentHref === tab.href)}
          <button
            aria-label={`Close ${titles[tab.href] ?? tab.label} tab`}
            onClick={async () => {
              if (await onClose(tab))
                requestAnimationFrame(() => active.current?.focus({ preventScroll: true }));
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        className="workbench-new-tab"
        aria-label="Open a new tab in this shoot"
        title="New tab"
        onClick={onNew}
      >
        <Plus size={17} />
      </button>
    </nav>
  );
}
