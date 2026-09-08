import { useEffect, useRef, useState } from "react";
import { accountInitials } from "@/lib/account-preferences";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { decodeAvatarSource, encodeAvatarCrop } from "@/lib/avatar-image";
import { AVATAR_METADATA_LIMIT } from "@/lib/account-profile";

export function AvatarEditor({
  value,
  name,
  onChange,
  disabled,
  kind = "avatar",
  maxBytes = AVATAR_METADATA_LIMIT,
}: {
  value: string;
  name: string;
  onChange: (value: string) => void;
  disabled: boolean;
  kind?: "avatar" | "companion";
  maxBytes?: number;
}) {
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const generation = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const cropSize = kind === "avatar" ? 512 : 128;
  useToolLeaveGuard(source || loading ? `Your ${kind} crop has not been applied.` : null);
  useEffect(
    () => () => {
      generation.current++;
      bitmap.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!source || !canvas.current) return;
    const size = Math.min(source.width, source.height) / zoom;
    const context = canvas.current.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, cropSize, cropSize);
    context.drawImage(
      source,
      ((source.width - size) * x) / 100,
      ((source.height - size) * y) / 100,
      size,
      size,
      0,
      0,
      cropSize,
      cropSize,
    );
  }, [source, zoom, x, y, cropSize]);
  const clearSource = () => {
    bitmap.current?.close();
    bitmap.current = null;
    setSource(null);
  };
  return (
    <div className="settings-avatar-editor">
      <div className="settings-inline-actions">
        <span className="account-avatar large">
          {value ? <img src={value} alt={`${kind} preview`} /> : accountInitials(name)}
        </span>
        <button
          className="settings-button"
          type="button"
          disabled={disabled || loading}
          onClick={() => picker.current?.click()}
        >
          {loading ? "Reading image…" : value ? `Replace ${kind}` : `Upload ${kind}`}
        </button>
        {value && (
          <button
            className="settings-button"
            type="button"
            disabled={disabled || loading || !!source}
            onClick={() => onChange("")}
          >
            Remove {kind}
          </button>
        )}
      </div>
      <p className="settings-footnote settings-avatar-hint">
        JPEG, PNG or WebP up to 50 MB · 100 MP. Resized on your device.
      </p>
      <input
        ref={picker}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const ticket = ++generation.current;
          setLoading(true);
          setError("");
          void decodeAvatarSource(file)
            .then((next) => {
              if (!next) return;
              if (ticket !== generation.current) {
                next.close();
                return;
              }
              clearSource();
              bitmap.current = next;
              setSource(next);
              setZoom(1);
              setX(50);
              setY(50);
            })
            .catch((failure: unknown) => {
              if (ticket === generation.current)
                setError(
                  failure instanceof Error && failure.message.startsWith("Choose ")
                    ? failure.message
                    : "Could not read this image. Try exporting a JPEG, PNG or WebP copy.",
                );
            })
            .finally(() => {
              if (ticket === generation.current) setLoading(false);
            });
        }}
      />
      {source && (
        <div className="settings-avatar-crop">
          <canvas
            ref={canvas}
            width={cropSize}
            height={cropSize}
            aria-label={`${kind} crop preview`}
          />
          {(
            [
              ["Zoom", zoom, setZoom, 1, 3, 0.1],
              ["Horizontal crop", x, setX, 0, 100, 1],
              ["Vertical crop", y, setY, 0, 100, 1],
            ] as const
          ).map(([label, current, setValue, min, max, step]) => (
            <label key={label}>
              {label}
              <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                disabled={disabled || loading}
                value={current}
                onChange={(e) => setValue(Number(e.target.value))}
              />
            </label>
          ))}
          <div className="settings-inline-actions">
            <button
              className="settings-button"
              type="button"
              disabled={disabled || loading}
              onClick={() => {
                try {
                  if (!canvas.current) return;
                  onChange(encodeAvatarCrop(canvas.current, maxBytes));
                  setError("");
                  clearSource();
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "Could not prepare the crop.",
                  );
                }
              }}
            >
              Use crop
            </button>
            <button
              className="settings-button"
              type="button"
              disabled={disabled || loading}
              onClick={clearSource}
            >
              Cancel crop
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
