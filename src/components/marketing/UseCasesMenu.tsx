import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UseCaseMark } from "@/components/marketing/UseCaseMark";
import { useNavMenu } from "@/components/marketing/nav-menu";
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
  const menu = useNavMenu("use-cases");
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [openConference, setOpenConference] = useState<string | null>(null);
  return (
    <DropdownMenu
      modal
      {...menu}
      onOpenChange={(next) => {
        menu.onOpenChange?.(next);
        if (!next) {
          setOpenCase(null);
          setOpenConference(null);
        }
      }}
    >
      <DropdownMenuTrigger className="marketing-nav__link">
        Use Cases
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={10}
        className="marketing-nav-menu marketing-nav-features marketing-nav-features--long"
      >
        {USE_CASES.map((item) =>
          "conferences" in item && item.conferences ? (
            <div key={item.id} className="marketing-nav-branch">
              <button
                type="button"
                className="marketing-nav-feature marketing-nav-feature--flyout"
                data-state={openCase === item.id ? "open" : undefined}
                aria-expanded={openCase === item.id}
                onClick={() => {
                  setOpenCase((current) => (current === item.id ? null : item.id));
                  setOpenConference(null);
                }}
              >
                <CaseRow mark={item.mark} title={item.title} copy={item.copy} />
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {openCase === item.id
                ? item.conferences.map((conference) => (
                    <div key={conference.id} className="marketing-nav-branch marketing-nav-branch--in">
                      <button
                        type="button"
                        className="marketing-nav-feature marketing-nav-feature--flyout"
                        data-state={openConference === conference.id ? "open" : undefined}
                        aria-expanded={openConference === conference.id}
                        onClick={() =>
                          setOpenConference((current) =>
                            current === conference.id ? null : conference.id,
                          )
                        }
                      >
                        <CaseRow mark={conference.mark} title={conference.title} />
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      {openConference === conference.id && "teams" in conference
                        ? conference.teams.map((team) => (
                            <DropdownMenuItem key={team.id} asChild>
                              <Link
                                to="/use-cases"
                                hash={conference.id}
                                className="marketing-nav-feature marketing-nav-feature--team marketing-nav-branch--in"
                              >
                                <CaseRow mark={team.id} title={team.title} />
                              </Link>
                            </DropdownMenuItem>
                          ))
                        : null}
                    </div>
                  ))
                : null}
            </div>
          ) : (
            <DropdownMenuItem key={item.id} asChild>
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
