import { useEffect, useRef, useState } from "react";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { Switch } from "@/components/ui/switch";
import { AppearanceBasics } from "./AppearanceBasics";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { AccountPreferences } from "@/lib/account-preferences";
import {
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  contrastRatio,
  exportTheme,
  importTheme,
  validateAppearance,
  type Appearance,
} from "@/lib/appearance";
import {
  SettingsRow as Row,
  SettingsGroup as Group,
  SettingsChoice as Choice,
} from "./SettingsPrimitives";

export function AppearanceSettings({
  prefs,
  save,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
}) {
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<Appearance | null>(null);
  const [pending, setPending] = useState<Appearance | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const colors = prefs.appearance;
  const generation = useRef(0);
  const baseline = useRef(colors);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useToolLeaveGuard(pending ? "A theme is waiting for confirmation." : null);
  const apply = (patch: Partial<Appearance>) => {
    try {
      const next = validateAppearance({ ...colors, ...patch });
      if (save({ appearance: next })) {
        setUndo(colors);
        setError("");
        return true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid theme.");
    }
    return false;
  };
  return (
    <>
      <div
        className="settings-theme-options"
        role="group"
        aria-label="Color mode"
        id="setting-color-mode"
        data-setting-id="setting-color-mode"
        tabIndex={-1}
      >
        {(["system", "light", "dark"] as const).map((theme) => (
          <button
            key={theme}
            aria-pressed={prefs.theme === theme}
            onClick={() => {
              if (theme === "light") {
                if (apply({ preset: "paper", ...THEME_PRESETS.paper })) save({ theme });
              } else if (theme === "dark") {
                if (apply({ preset: "lenslabs", ...THEME_PRESETS.lenslabs })) save({ theme });
              } else save({ theme });
            }}
          >
            <span className={`settings-theme-sample sample-${theme}`} aria-hidden="true">
              <i />
              <span>
                <b />
                <b />
                <b />
              </span>
            </span>
            {theme[0]!.toUpperCase() + theme.slice(1)}
          </button>
        ))}
      </div>
      <Group title="Theme">
        <AppearanceBasics prefs={prefs} save={save} />
        <Row
          title="Dark theme"
          note="Light is white like a page. Dark is black. Pick Background and Text if you want your own."
        >
          <Choice
            label="Dark theme"
            value={colors.preset}
            options={[
              ["paper", "Light"],
              ["lenslabs", "Dark"],
              ...(colors.preset === "custom" ||
              colors.preset === "midnight" ||
              colors.preset === "warm"
                ? ([
                    [colors.preset, colors.preset === "custom" ? "Custom" : colors.preset] as const,
                  ] as const)
                : []),
            ]}
            change={(preset) =>
              apply({
                preset: preset as Appearance["preset"],
                ...THEME_PRESETS[preset as keyof typeof THEME_PRESETS],
              })
            }
          />
        </Row>
        {(["background", "foreground"] as const).map((key) => (
          <Row key={key} title={key === "background" ? "Background" : "Text"}>
            <label className="settings-color">
              <span>{colors[key]}</span>
              <input
                type="color"
                aria-label={`${key} color`}
                value={colors[key]}
                onChange={(e) => apply({ [key]: e.target.value, preset: "custom" })}
              />
            </label>
          </Row>
        ))}
        <Row title="Gradient">
          <Choice
            label="Gradient"
            value={colors.backgroundStyle}
            options={[
              ["solid", "Off"],
              ["gradient", "On"],
            ]}
            change={(value) =>
              apply({ backgroundStyle: value as Appearance["backgroundStyle"], preset: "custom" })
            }
          />
        </Row>
        {colors.backgroundStyle === "gradient" && (
          <Row title="Fade to">
            <label className="settings-color">
              <span>{colors.backgroundEnd}</span>
              <input
                type="color"
                aria-label="Gradient end color"
                value={colors.backgroundEnd}
                onChange={(e) => apply({ backgroundEnd: e.target.value, preset: "custom" })}
              />
            </label>
          </Row>
        )}
        <Row title="UI font">
          <Choice
            label="UI font"
            value={colors.uiFont}
            options={[
              ["system", "System"],
              ["sans", "Sans serif"],
              ["serif", "Serif"],
            ]}
            change={(value) => apply({ uiFont: value as Appearance["uiFont"] })}
          />
        </Row>
        <Row title="Code font" note="Used for metadata, code and shortcut labels.">
          <Choice
            label="Code font"
            value={colors.codeFont}
            options={[
              ["mono", "Monospace"],
              ["system-mono", "Menlo / Consolas"],
            ]}
            change={(value) => apply({ codeFont: value as Appearance["codeFont"] })}
          />
        </Row>
        <Row title="Interface size">
          <label className="settings-range">
            <input
              aria-label="Interface size"
              type="range"
              min="13"
              max="18"
              value={colors.uiSize}
              onChange={(e) => apply({ uiSize: Number(e.target.value) })}
            />
            <output>{colors.uiSize}px</output>
          </label>
        </Row>
        <Row title="Code size">
          <label className="settings-range">
            <input
              aria-label="Code size"
              type="range"
              min="12"
              max="20"
              value={colors.codeSize}
              onChange={(e) => apply({ codeSize: Number(e.target.value) })}
            />
            <output>{colors.codeSize}px</output>
          </label>
        </Row>
        <Row title="Density">
          <Choice
            label="Density"
            value={colors.density}
            options={[
              ["compact", "Compact"],
              ["comfortable", "Comfortable"],
            ]}
            change={(value) => apply({ density: value as Appearance["density"] })}
          />
        </Row>
        <Row
          title="Translucent sidebar"
          note="A subtle browser-only surface; does not reveal other applications."
        >
          <Switch
            aria-label="Translucent sidebar"
            checked={colors.translucentSidebar}
            onCheckedChange={(value) => apply({ translucentSidebar: value })}
          />
        </Row>
        <Row
          title="Sidebar opacity"
          note="Higher values make the background more solid. Your photographs are unchanged."
        >
          <label className="settings-range">
            <input
              type="range"
              aria-label="Sidebar opacity"
              min={20}
              max={100}
              step={5}
              disabled={!colors.translucentSidebar}
              value={colors.sidebarOpacity}
              onChange={(event) => apply({ sidebarOpacity: Number(event.target.value) })}
            />
            <output>{colors.translucentSidebar ? colors.sidebarOpacity : 100}%</output>
          </label>
        </Row>
        <Row
          title="Text contrast"
          note="Unreadable text/background combinations are rejected before saving."
        >
          <output>{contrastRatio(colors.background, colors.foreground).toFixed(1)}:1</output>
        </Row>
      </Group>
      <Group title="Preferences">
        <Row title="Reduce motion">
          <Switch
            aria-label="Reduce motion"
            checked={prefs.reduceMotion}
            onCheckedChange={(reduceMotion) => save({ reduceMotion })}
          />
        </Row>
        <Row title="Use pointer cursors">
          <Switch
            aria-label="Use pointer cursors"
            checked={prefs.pointerCursors}
            onCheckedChange={(pointerCursors) => save({ pointerCursors })}
          />
        </Row>
        <Row title="Keep sidebar open">
          <Switch
            aria-label="Keep sidebar open"
            checked={prefs.sidebarOpen}
            onCheckedChange={(sidebarOpen) => save({ sidebarOpen })}
          />
        </Row>
      </Group>
      <div className="settings-inline-actions">
        <button
          className="settings-button"
          id="setting-import-theme"
          data-setting-id="setting-import-theme"
          onClick={() => picker.current?.click()}
        >
          Import theme
        </button>
        <button
          className="settings-button"
          id="setting-export-theme"
          data-setting-id="setting-export-theme"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([exportTheme(colors)], { type: "application/json" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "lenslabs-theme.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export theme
        </button>
        <button
          className="settings-button"
          disabled={!undo}
          id="setting-undo-theme-change"
          data-setting-id="setting-undo-theme-change"
          onClick={() => {
            if (undo && save({ appearance: undo })) setUndo(null);
          }}
        >
          Undo theme change
        </button>
        <button
          className="settings-button"
          id="setting-reset-theme"
          data-setting-id="setting-reset-theme"
          onClick={() => {
            baseline.current = colors;
            setPending(DEFAULT_APPEARANCE);
          }}
        >
          Reset theme
        </button>
      </div>
      <input
        type="file"
        ref={picker}
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const ticket = ++generation.current;
          baseline.current = colors;
          if (file.size > 8192) {
            setError("Choose a theme smaller than 8 KB.");
            return;
          }
          void file
            .text()
            .then((text) => {
              if (ticket !== generation.current) return;
              setPending(importTheme(text));
              setError("");
            })
            .catch(() => {
              if (ticket === generation.current)
                setError("Invalid or unreadable LensLabs theme. Nothing changed.");
            });
        }}
      />
      {error && <p role="alert">{error}</p>}
      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this theme?</AlertDialogTitle>
            <AlertDialogDescription>
              Only colors, typography and density change. Your photos, instructions and permissions
              stay unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p>
            {pending?.preset} · {pending?.uiSize}px · {pending?.density}
          </p>
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (JSON.stringify(baseline.current) !== JSON.stringify(colors)) {
                  setError(
                    "Appearance changed while the preview was open. Cancel and review it again.",
                  );
                  return;
                }
                if (pending && apply(pending)) setPending(null);
              }}
            >
              Apply theme
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
