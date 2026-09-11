import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UseCaseMark } from "@/components/marketing/UseCaseMark";
import { hoverMenuTrigger, useNavMenuHover } from "@/components/marketing/nav-menu";
import {
  ACC_TEAMS,
  BIG12_TEAMS,
  BIG_TEN_TEAMS,
  SEC_TEAMS,
} from "@/components/marketing/college-football";

export { ACC_TEAMS, BIG12_TEAMS, BIG_TEN_TEAMS, SEC_TEAMS };

export const FOOTBALL_CONFERENCES = [
  {
    id: "big-ten",
    mark: "bigten",
    title: "Big Ten",
    teams: BIG_TEN_TEAMS,
  },
  {
    id: "sec",
    mark: "sec",
    title: "SEC",
    teams: SEC_TEAMS,
  },
  {
    id: "acc",
    mark: "acc",
    title: "ACC",
    teams: ACC_TEAMS,
  },
  {
    id: "big-12",
    mark: "big12",
    title: "Big 12",
    teams: BIG12_TEAMS,
  },
] as const;

export const PHOTOGRAPHY_TYPES = [
  { id: "sports", mark: "sports", title: "Sports photography" },
  { id: "wedding", mark: "wedding", title: "Wedding photography" },
] as const;

export const USE_CASES = [
  {
    id: "college-football",
    mark: "usc",
    title: "College football",
    copy: "Sideline to gallery the same night.",
    conferences: FOOTBALL_CONFERENCES,
  },
  ...PHOTOGRAPHY_TYPES,
] as const;

export const USE_CASE_SECTIONS = [
  ...FOOTBALL_CONFERENCES,
  ...PHOTOGRAPHY_TYPES,
] as const;

function CaseRow({
  mark,
  title,
  copy,
}: {
  mark: string;
  title: string;
  copy?: string;
}) {
  return (
    <>
      <span className="marketing-nav-feature__icon" aria-hidden="true">
        <UseCaseMark id={mark} />
      </span>
      <span>
        <strong>{title}</strong>
        {copy ? <span>{copy}</span> : null}
      </span>
    </>
  );
}

export function UseCasesMenu() {
  const menu = useNavMenuHover("use-cases");
  const trigger = hoverMenuTrigger(menu);
  const [footballOpen, setFootballOpen] = useState(false);
  const [openConference, setOpenConference] = useState<string | null>(null);
  return (
    <DropdownMenu
      modal
      open={menu.open}
      onOpenChange={(next) => {
        menu.onOpenChange?.(next);
        if (!next) {
          setFootballOpen(false);
          setOpenConference(null);
        }
      }}
    >
      <DropdownMenuTrigger className="marketing-nav__link" {...trigger}>
        Use Cases
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={10}
        collisionPadding={{ top: 12, left: 12, bottom: 12, right: 256 }}
        onPointerEnter={menu.openNow}
        onPointerLeave={menu.closeSoon}
        className="marketing-nav-menu marketing-nav-features marketing-nav-use-cases"
      >
        {USE_CASES.map((item) =>
          "conferences" in item && item.conferences ? (
            <div key={item.id} className="marketing-nav-branch">
              <button
                type="button"
                className="marketing-nav-feature marketing-nav-feature--flyout"
                aria-expanded={footballOpen}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setFootballOpen((open) => !open);
                  setOpenConference(null);
                }}
              >
                <CaseRow mark={item.mark} title={item.title} copy={item.copy} />
                <ChevronDown size={14} aria-hidden="true" className="marketing-nav-chevron-down" />
              </button>
              {footballOpen
                ? item.conferences.map((conference) => (
                    <div
                      key={conference.id}
                      className="marketing-nav-conference marketing-nav-branch--in"
                    >
                      <button
                        type="button"
                        className="marketing-nav-feature marketing-nav-feature--flyout"
                        data-state={openConference === conference.id ? "open" : undefined}
                        aria-expanded={openConference === conference.id}
                        aria-haspopup="menu"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenConference((current) =>
                            current === conference.id ? null : conference.id,
                          );
                        }}
                      >
                        <CaseRow mark={conference.mark} title={conference.title} />
                        <ChevronRight
                          size={14}
                          aria-hidden="true"
                          className="marketing-nav-chevron-right"
                        />
                      </button>
                      {openConference === conference.id && "teams" in conference ? (
                        <div className="marketing-nav-teams" role="menu">
                          {conference.teams.map((team) => (
                            <DropdownMenuItem key={team.id} asChild>
                              <Link
                                to="/use-cases"
                                hash={conference.id}
                                className="marketing-nav-feature marketing-nav-feature--team"
                              >
                                <CaseRow mark={team.id} title={team.title} />
                              </Link>
                            </DropdownMenuItem>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                : null}
            </div>
          ) : (
            <DropdownMenuItem
              key={item.id}
              asChild
              onPointerEnter={() => setOpenConference(null)}
            >
              <Link to="/use-cases" hash={item.id} className="marketing-nav-feature">
                <CaseRow mark={item.mark} title={item.title} />
              </Link>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
