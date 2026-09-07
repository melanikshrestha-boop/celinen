import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { listProjects } from "@/lib/projects/repository";
export function ProjectSwitcher({
  projectId,
  open,
}: {
  projectId: string | null;
  open: (href: string) => Promise<boolean>;
}) {
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState("");
  const run = useRef(0);
  const refresh = useCallback(() => {
    const current = ++run.current;
    if (isLocalSingleUserMode)
      void listProjects()
        .then((rows) => {
          if (run.current !== current) return;
          setProjects(rows.map((row) => ({ id: row.id, title: row.title })));
          setError("");
        })
        .catch(() => {
          if (run.current === current) setError("Saved shoots could not be read.");
        });
  }, []);
  useEffect(() => {
    const requestRun = run;
    refresh();
    return () => {
      requestRun.current++;
    };
  }, [projectId, refresh]);
  const title = projectId
    ? (projects.find((row) => row.id === projectId)?.title ?? "Saved shoot")
    : "Current shoot";
  return (
    <DropdownMenu
      onOpenChange={(value) => {
        if (value) refresh();
      }}
    >
      <DropdownMenuTrigger className="workbench-project-switcher">
        <FolderOpen size={16} />
        <span>{title}</span>
        <ChevronDown size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="workbench-project-menu">
        <DropdownMenuLabel>Project workspace</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => {
            void open("/studio");
          }}
        >
          Current shoot
        </DropdownMenuItem>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => {
              void open(`/studio?project=${project.id}`);
            }}
          >
            {project.title}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() => {
            void open("/projects");
          }}
        >
          Manage projects…
        </DropdownMenuItem>
        {error && <p role="alert">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
