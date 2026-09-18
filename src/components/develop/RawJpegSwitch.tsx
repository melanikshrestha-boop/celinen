import { useMemo } from "react";
import {
  resolveRawJpegSwitch,
  switchTargetForPhoto,
  type RawJpegPairable,
  type RawJpegSwitchTarget,
} from "@/lib/develop/raw-jpeg-pair";
import "./raw-jpeg-switch.css";

export function RawJpegSwitch({
  photo,
  photos,
  disabled,
  onSwitch,
}: {
  photo: RawJpegPairable | null | undefined;
  photos: readonly RawJpegPairable[];
  disabled?: boolean;
  onSwitch: (id: string) => void;
}) {
  const target = useMemo(
    () => (photo ? switchTargetForPhoto(photo, photos) : null),
    [photo, photos],
  );
  if (!photo || !target) return null;

  const select = (next: RawJpegSwitchTarget) => {
    const id = resolveRawJpegSwitch(photo.id, next, photos);
    if (id !== photo.id) onSwitch(id);
  };

  return (
    <div className="raw-jpeg-switch" role="group" aria-label="RAW or JPEG companion">
      <button
        type="button"
        aria-pressed={target === "raw"}
        disabled={disabled || target === "raw"}
        onClick={() => select("raw")}
      >
        RAW
      </button>
      <button
        type="button"
        aria-pressed={target === "jpeg"}
        disabled={disabled || target === "jpeg"}
        onClick={() => select("jpeg")}
      >
        JPEG
      </button>
    </div>
  );
}
