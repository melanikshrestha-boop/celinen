import { ArrowUpRight } from "lucide-react";
import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { WORKBENCH_TOOLS } from "@/lib/workbench";

export function ToolPalette({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="workbench-search"
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogTitle className="sr-only">Tools and connections</DialogTitle>
        <DialogDescription className="sr-only">
          Search all workspace tools. Use arrow keys to choose and Enter to open a tab in this
          shoot.
        </DialogDescription>
        <Command loop>
          <CommandInput
            placeholder="Find a tool or connection…"
            aria-label="Search workspace tools"
          />
          <CommandList>
            <CommandEmpty>No matching tools.</CommandEmpty>
            {Array.from(new Set(WORKBENCH_TOOLS.map((tool) => tool.group))).map((group) => (
              <CommandGroup key={group} heading={group}>
                {WORKBENCH_TOOLS.filter((tool) => tool.group === group).map((tool) => (
                  <CommandItem
                    key={tool.path}
                    value={`${tool.label} ${tool.path}`}
                    onSelect={() => {
                      onOpenChange(false);
                      onSelect(tool.path);
                    }}
                  >
                    <span>{tool.label}</span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <p className="workbench-palette-hint">
          ↑ ↓ choose <span>↵ open</span>
          <span>esc close</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
