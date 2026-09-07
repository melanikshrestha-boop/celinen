import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StudioFilter } from "@/lib/studio/session";

export function StudioFilterMenu({
  value,
  counts,
  onChange,
}: {
  value: StudioFilter;
  counts: Record<StudioFilter, number>;
  onChange: (value: StudioFilter) => void;
}) {
  const labels: Record<StudioFilter, string> = {
    all: "All photos",
    todo: "To review",
    keepers: "Keepers",
    flagged: "Flagged",
    rejected: "Rejected",
  };
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (Object.hasOwn(labels, next)) onChange(next as StudioFilter);
      }}
    >
      <SelectTrigger className="workbench-photo-filter" aria-label="Filter photos">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="workbench-photo-filter-menu">
        {(Object.keys(labels) as StudioFilter[]).map((key) => (
          <SelectItem key={key} value={key}>
            {labels[key]} · {counts[key].toLocaleString()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
