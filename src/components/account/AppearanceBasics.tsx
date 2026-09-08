import { useEffect, useState } from "react";
import {
  THEME_PRESETS,
  normalizeColor,
  validateAppearance,
  type Appearance,
} from "@/lib/appearance";
import type { AccountPreferences } from "@/lib/account-preferences";
import { SettingsRow as Row, SettingsChoice as Choice } from "./SettingsPrimitives";
import { Switch } from "@/components/ui/switch";
import { AccentColorPicker } from "./AccentColorPicker";

export function AppearanceBasics({
  prefs,
  save,
  mode = false,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
  mode?: boolean;
}) {
  const [hex, setHex] = useState(prefs.appearance.accent);
  const [end, setEnd] = useState(prefs.appearance.accentEnd);
  const [error, setError] = useState("");
  useEffect(() => setHex(prefs.appearance.accent), [prefs.appearance.accent]);
  useEffect(() => setEnd(prefs.appearance.accentEnd), [prefs.appearance.accentEnd]);
  const apply = (patch: Partial<Appearance>) => {
    try {
      const appearance = validateAppearance({ ...prefs.appearance, ...patch });
      if (save({ appearance })) setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid color.");
    }
  };
  const commit = (key: "accent" | "accentEnd", value: string) => {
    try {
      apply({ [key]: normalizeColor(value), preset: "custom" });
    } catch {
      setError("Enter a 3- or 6-digit hex code, such as #e98aba.");
    }
  };
  return (
    <>
      {mode && (
        <Row title="Appearance">
          <Choice
            label="Appearance"
            value={prefs.theme}
            options={[
              ["system", "System"],
              ["dark", "Dark"],
              ["light", "Light"],
            ]}
            change={(theme) => {
              const next = theme as AccountPreferences["theme"];
              if (next === "light")
                save({
                  theme: next,
                  appearance: validateAppearance({
                    ...prefs.appearance,
                    preset: "paper",
                    ...THEME_PRESETS.paper,
                  }),
                });
              else if (next === "dark")
                save({
                  theme: next,
                  appearance: validateAppearance({
                    ...prefs.appearance,
                    preset: "lenslabs",
                    ...THEME_PRESETS.lenslabs,
                  }),
                });
              else save({ theme: next });
            }}
          />
        </Row>
      )}
      <Row
        title="Contrast"
        note="Increase text and control contrast without changing your photographs."
      >
        <Choice
          label="Contrast"
          value={prefs.appearance.contrast}
          options={[
            ["system", "System"],
            ["standard", "Standard"],
            ["more", "More"],
          ]}
          change={(contrast) => apply({ contrast: contrast as Appearance["contrast"] })}
        />
      </Row>
      <Row title="Accent color">
        <AccentColorPicker value={prefs.appearance.accent} change={(accent) => apply({ accent })} />
      </Row>
      <Row
        title="Custom accent"
        note="Hex code, with or without #. Unreadable control colors are rejected."
      >
        <form
          className="settings-hex-form"
          onSubmit={(e) => {
            e.preventDefault();
            commit("accent", hex);
          }}
        >
          <input
            type="color"
            aria-label="Choose accent color"
            value={prefs.appearance.accent}
            onChange={(e) => apply({ accent: e.target.value, preset: "custom" })}
          />
          <input
            id="custom-accent-hex"
            aria-label="Custom accent hex"
            value={hex}
            maxLength={7}
            onChange={(e) => setHex(e.target.value)}
          />
          <button className="settings-button">Apply</button>
        </form>
      </Row>
      <Row
        title="Accent style"
        note="Optional gradient on the workspace selection marker. Controls stay solid for readability."
      >
        <Choice
          label="Accent style"
          value={prefs.appearance.accentStyle}
          options={[
            ["solid", "Solid"],
            ["gradient", "Gradient"],
          ]}
          change={(accentStyle) => apply({ accentStyle: accentStyle as Appearance["accentStyle"] })}
        />
      </Row>
      {prefs.appearance.accentStyle === "gradient" && (
        <Row title="Gradient end">
          <form
            className="settings-hex-form"
            onSubmit={(e) => {
              e.preventDefault();
              commit("accentEnd", end);
            }}
          >
            <span
              className="settings-gradient-sample"
              style={{
                background: `linear-gradient(115deg,${prefs.appearance.accent},${prefs.appearance.accentEnd})`,
              }}
            />
            <input
              aria-label="Gradient end hex"
              value={end}
              maxLength={7}
              onChange={(e) => setEnd(e.target.value)}
            />
            <button className="settings-button">Apply</button>
          </form>
        </Row>
      )}
      <Row
        title="Workspace grid"
        note="A quiet alignment grid behind the chat canvas. Photos are unchanged."
      >
        <Switch
          aria-label="Workspace grid"
          checked={prefs.appearance.grid}
          onCheckedChange={(grid) => apply({ grid })}
        />
      </Row>
      {error && (
        <p role="alert" className="settings-footnote">
          {error}
        </p>
      )}
    </>
  );
}
