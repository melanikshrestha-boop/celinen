import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DevelopPhotoActions({
  disabled,
  canPaste,
  rename,
  duplicate,
  copy,
  paste,
}: {
  disabled: boolean;
  canPaste: boolean;
  rename: () => void;
  duplicate: () => void;
  copy: () => void;
  paste: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Photo actions" disabled={disabled}>
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="develop-photo-menu">
        <DropdownMenuItem onSelect={rename}>Rename for library & exports…</DropdownMenuItem>
        <DropdownMenuItem onSelect={duplicate}>Create virtual copy</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={copy}>Copy photo in Celinen</DropdownMenuItem>
        <DropdownMenuItem disabled={!canPaste} onSelect={paste}>
          Paste photo as virtual copy
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
