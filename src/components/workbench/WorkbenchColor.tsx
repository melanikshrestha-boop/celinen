import { Palette } from "lucide-react";
import { useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { THEME_PRESETS, validateAppearance, type Appearance } from "@/lib/appearance";
import "./workbench-color.css";

export function WorkbenchColor() {
  const account = useAccount();
  const [error, setError] = useState("");
  if (!account) return null;
  const prefs = account.preferences;
  const colors = prefs.appearance;

  const apply = (patch: Partial<Appearance> & { theme?: "light" | "dark" }) => {
    try {
      const { theme, ...rest } = patch;
      const appearance = validateAppearance({ ...colors, ...rest });
      account.savePreferences({
        appearance,
        ...(theme ? { theme } : {}),
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pick colors that still read.");
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="workbench-tools-button" aria-label="Color" title="Color">
          <Palette size={17} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="wb-color">
        <p className="wb-color-h">Color</p>
        <div className="wb-color-modes" role="group" aria-label="Mode">
          <button
            type="button"
            aria-pressed={prefs.theme === "light"}
            onClick={() => apply({ theme: "light", preset: "paper", ...THEME_PRESETS.paper })}
          >
            Light
          </button>
          <button
            type="button"
            aria-pressed={prefs.theme === "dark"}
            onClick={() => apply({ theme: "dark", preset: "lenslabs", ...THEME_PRESETS.lenslabs })}
          >
            Dark
          </button>
        </div>
        <label className="wb-color-row">
          Background
          <input
            type="color"
            aria-label="Background color"
            value={colors.background}
            onChange={(e) => apply({ background: e.target.value, preset: "custom" })}
          />
        </label>
        <label className="wb-color-row">
          Text
          <input
            type="color"
            aria-label="Text color"
            value={colors.foreground}
            onChange={(e) => apply({ foreground: e.target.value, preset: "custom" })}
          />
        </label>
        <label className="wb-color-row">
          Gradient
          <input
            type="checkbox"
            checked={colors.backgroundStyle === "gradient"}
            onChange={(e) =>
              apply({ backgroundStyle: e.target.checked ? "gradient" : "solid", preset: "custom" })
            }
          />
        </label>
        {colors.backgroundStyle === "gradient" ? (
          <label className="wb-color-row">
            Fade to
            <input
              type="color"
              aria-label="Gradient end color"
              value={colors.backgroundEnd}
              onChange={(e) => apply({ backgroundEnd: e.target.value, preset: "custom" })}
            />
          </label>
        ) : null}
        {error ? (
          <p className="wb-color-err" role="alert">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
