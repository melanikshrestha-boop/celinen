import "./settings-switch.css";

/** Grok-settings on/off: sliding white knob, click or Space/Enter. */
export function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="settings-switch"
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="settings-switch__thumb" />
    </button>
  );
}
