import { useRef, useState } from "react";
import { hapticTap } from "@/lib/haptic-press";
import "./settings-switch.css";

/** Grok-settings on/off: sliding knob with spring overshoot on change. */
export function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
}) {
  const [changing, setChanging] = useState(false);
  const popTimer = useRef(0);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={changing ? "settings-switch is-changing" : "settings-switch"}
      onPointerDown={() => hapticTap()}
      onClick={() => {
        onCheckedChange(!checked);
        setChanging(true);
        window.clearTimeout(popTimer.current);
        popTimer.current = window.setTimeout(() => setChanging(false), 520);
      }}
    >
      <span className="settings-switch__thumb" />
    </button>
  );
}
