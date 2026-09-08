import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCENT_COLORS, accentColorName } from "@/lib/appearance";
import { useWorkspaceText } from "./useWorkspaceText";
import "./accent-color-picker.css";

/** Screenshot-matched styling; the public Codex CLI repo does not contain this desktop menu. */
export function AccentColorPicker({
  value,
  change,
}: {
  value: string;
  change: (color: string) => void;
}) {
  const t = useWorkspaceText();
  const name = accentColorName(value);
  return (
    <Select
      value={name}
      onValueChange={(next) => {
        const option = ACCENT_COLORS.find(([label]) => label === next);
        if (option) change(option[1]);
      }}
    >
      <SelectTrigger className="settings-accent-trigger" aria-label="Accent color">
        <SelectValue>
          <span className="settings-accent-label">
            <span
              className="settings-accent-swatch"
              style={{ backgroundColor: value }}
              aria-hidden="true"
            />
            {t(name)}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        className="settings-accent-menu"
        align="end"
        sideOffset={6}
        collisionPadding={12}
      >
        {ACCENT_COLORS.map(([label, color]) => (
          <SelectItem
            className="settings-accent-option"
            value={label}
            key={label}
            textValue={t(label)}
          >
            <span className="settings-accent-label">
              <span
                className="settings-accent-swatch"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              {t(label)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
