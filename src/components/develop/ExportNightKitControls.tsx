import type { ExportBorder, WatermarkKit } from "@/lib/develop/export-night-kit";
import "./export-night-kit.css";

export function ExportNightKitControls({
  border,
  kits,
  activeKitId,
  applyKit,
  disabled,
  onBorderChange,
  onActiveKitChange,
  onKitTextChange,
  exportCount,
}: {
  border: ExportBorder;
  kits: readonly WatermarkKit[];
  activeKitId: string | null;
  applyKit: boolean;
  disabled?: boolean;
  onBorderChange: (next: ExportBorder) => void;
  onActiveKitChange: (id: string | null) => void;
  onKitTextChange: (text: string) => void;
  exportCount: number;
}) {
  const active = kits.find((kit) => kit.id === activeKitId) ?? null;
  return (
    <div className="develop-night-kit" aria-label="Export night kit">
      <label className="develop-check">
        <input
          type="checkbox"
          checked={border.enabled}
          disabled={disabled}
          onChange={(e) => onBorderChange({ ...border, enabled: e.target.checked })}
        />
        Border on export (also shown in edit)
      </label>
      {border.enabled && (
        <div className="develop-night-kit-row">
          <label>
            Border width
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              disabled={disabled}
              value={Math.round(border.widthRatio * 100)}
              onChange={(e) =>
                onBorderChange({
                  ...border,
                  widthRatio: Number(e.target.value) / 100,
                })
              }
            />
          </label>
          <label>
            Border color
            <input
              type="color"
              disabled={disabled}
              value={border.color.length === 7 ? border.color : "#ffffff"}
              onChange={(e) => onBorderChange({ ...border, color: e.target.value })}
            />
          </label>
        </div>
      )}
      <label className="develop-check">
        <input
          type="checkbox"
          checked={applyKit}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.checked) onActiveKitChange(kits[0]?.id ?? null);
            else onActiveKitChange(null);
          }}
        />
        Watermark kit
      </label>
      {applyKit && (
        <>
          <label>
            Named kit
            <select
              disabled={disabled}
              value={activeKitId ?? ""}
              onChange={(e) => onActiveKitChange(e.target.value || null)}
              aria-label="Watermark kit"
            >
              {kits.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.name}
                </option>
              ))}
            </select>
          </label>
          {active && (
            <label>
              Kit text
              <input
                type="text"
                maxLength={80}
                disabled={disabled}
                value={active.text}
                onChange={(e) => onKitTextChange(e.target.value)}
                aria-label="Watermark kit text"
              />
            </label>
          )}
          <p className="develop-export-disclosure">
            Kits stay on this device ({kits.length} saved). Client sheet On/Off maps to these names.
          </p>
        </>
      )}
      {exportCount > 1 && (
        <p className="develop-export-disclosure">
          {exportCount} selected photos export one after another. Cancel stops the next file; a
          single failure does not block the rest.
        </p>
      )}
    </div>
  );
}
