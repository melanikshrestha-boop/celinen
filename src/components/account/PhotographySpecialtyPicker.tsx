import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  MAX_SPECIALTIES,
  PHOTOGRAPHY_SPECIALTIES,
  photographySpecialtyLabel,
} from "@/lib/photography-specialties";

export function PhotographySpecialtyPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id="profile-specialties"
          className="profile-specialty-trigger"
          type="button"
          disabled={disabled}
          aria-labelledby="profile-specialties-label"
          aria-describedby="profile-specialties-hint"
        >
          <span className={!value.length ? "profile-specialty-placeholder" : undefined}>
            {value.length
              ? value.map(photographySpecialtyLabel).join(", ")
              : "Choose your specialties"}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="profile-specialty-popover" align="start" collisionPadding={12}>
        <Command>
          <CommandInput
            placeholder="Search specialties…"
            aria-label="Search photography specialties"
          />
          <CommandList aria-label="Photography specialties">
            <CommandEmpty>No matches. Clear your search to choose Other.</CommandEmpty>
            {PHOTOGRAPHY_SPECIALTIES.map(({ group, items }) => (
              <CommandGroup heading={group} key={group}>
                {items.map(([id, label]) => {
                  const chosen = value.includes(id);
                  return (
                    <CommandItem
                      key={id}
                      value={label}
                      keywords={[group, id]}
                      aria-label={`${label}${chosen ? ", selected" : ""}`}
                      disabled={!chosen && value.length >= MAX_SPECIALTIES}
                      onSelect={() =>
                        onChange(chosen ? value.filter((entry) => entry !== id) : [...value, id])
                      }
                    >
                      <Check size={16} aria-hidden="true" style={{ opacity: chosen ? 1 : 0 }} />
                      {label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="profile-specialty-footer">
          <span role="status">
            {value.length}/{MAX_SPECIALTIES} selected
          </span>
          <button className="settings-button" type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
