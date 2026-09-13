import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StudioFilter } from "@/lib/studio/session";
import { useRef } from "react";

export function StudioFilterMenu({
  value,
  counts,
  onChange,
  onQueueFocus,
}: {
  value: StudioFilter;
  counts: Record<StudioFilter, number>;
  onChange: (value: StudioFilter) => void;
  onQueueFocus?: () => void;
}) {
  const changed = useRef(false);
  const labels: Record<StudioFilter, string> = {
    all: "All photos",
    todo: "To review",
    keepers: "Keepers",
    flagged: "Red dots",
    rejected: "Rejected",
  };
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (Object.hasOwn(labels, next)) {
          changed.current = true;
          onChange(next as StudioFilter);
        }
      }}
    >
      <SelectTrigger className="workbench-photo-filter" aria-label="Filter photos">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className="workbench-photo-filter-menu"
        onCloseAutoFocus={(event) => {
          // Radix otherwise restores focus to the select, where K is type-ahead
          // for Keepers rather than the photographer's Keep shortcut.
          if (changed.current && onQueueFocus) {
            event.preventDefault();
            onQueueFocus();
          }
          changed.current = false;
        }}
      >
        {(Object.keys(labels) as StudioFilter[]).map((key) => (
          <SelectItem key={key} value={key}>
            {labels[key]} · {counts[key].toLocaleString()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
