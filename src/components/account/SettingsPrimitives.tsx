import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingId } from "@/lib/settings-inventory";
import { useWorkspaceText } from "./useWorkspaceText";

export function SettingsRow({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | undefined;
  children?: ReactNode;
}) {
  const id = settingId(title);
  const t = useWorkspaceText();
  return (
    <div
      id={id}
      data-setting-id={id}
      className="settings-row"
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={note ? `${id}-description` : undefined}
      tabIndex={-1}
    >
      <div>
        <h3 id={`${id}-label`}>{t(title)}</h3>
        {note && <p id={`${id}-description`}>{note}</p>}
      </div>
      {children && <div className="settings-control">{children}</div>}
    </div>
  );
}
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const t = useWorkspaceText();
  return (
    <section className="settings-group" aria-label={title}>
      <h2>{t(title)}</h2>
      <div className="settings-group-rows">{children}</div>
    </section>
  );
}
export function SettingsChoice({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  change: (value: string) => void;
}) {
  const t = useWorkspaceText();
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, name]) => (
          <SelectItem value={key} key={key}>
            {t(name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
