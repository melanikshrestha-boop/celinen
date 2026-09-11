import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  return (
    <DropdownMenu modal {...menu}>
      <DropdownMenuTrigger className="marketing-nav__link">
        Use Cases
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={10}
        className="marketing-nav-menu marketing-nav-features"
      >
        {USE_CASES.map((item) =>
          "conferences" in item && item.conferences ? (
            <DropdownMenuSub key={item.id}>
              <DropdownMenuSubTrigger className="marketing-nav-feature marketing-nav-feature--flyout">
                <CaseRow mark={item.mark} title={item.title} copy={item.copy} />
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  sideOffset={8}
                  align="start"
                  className="marketing-nav-menu marketing-nav-features marketing-nav-sub"
                >
                  {item.copy ? (
                    <p className="marketing-nav-sub__lede">{item.copy}</p>
                  ) : null}
                  {item.conferences.map((conference) =>
                    "teams" in conference && conference.teams ? (
                      <DropdownMenuSub key={conference.id}>
                        <DropdownMenuSubTrigger className="marketing-nav-feature marketing-nav-feature--flyout">
                          <CaseRow mark={conference.mark} title={conference.title} />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent
                            side="right"
                            sideOffset={8}
                            align="start"
                            avoidCollisions={false}
                            className="marketing-nav-menu marketing-nav-features marketing-nav-sub marketing-nav-sub--teams"
                          >
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
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                    ) : (
                      <DropdownMenuItem key={conference.id} asChild>
                        <Link
                          to="/use-cases"
                          hash={conference.id}
                          className="marketing-nav-feature"
                        >
                          <CaseRow mark={conference.mark} title={conference.title} />
                        </Link>
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
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
