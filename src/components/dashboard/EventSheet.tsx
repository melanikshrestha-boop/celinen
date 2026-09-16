import { useEffect, useRef, useState } from "react";
import { mapsSearchUrl, searchPlaces, type MapPlace } from "@/lib/maps-places";

export type EventSheetValue = {
  id?: string;
  title: string;
  location: string;
  mapsUrl: string;
  allDay: boolean;
  start: number;
  end: number;
};

type Props = {
  mode: "create" | "edit";
  value: EventSheetValue;
  anchor: { top: number; left: number };
  onChange: (next: EventSheetValue) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

function ymd(ms: number) {
  const day = new Date(ms);
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${m}-${d}`;
}

function hm(ms: number) {
  const day = new Date(ms);
  return `${String(day.getHours()).padStart(2, "0")}:${String(day.getMinutes()).padStart(2, "0")}`;
}

function stitch(date: string, time: string, allDay: boolean, end = false) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return Date.now();
  if (allDay) return new Date(year, month - 1, day + (end ? 1 : 0)).getTime();
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0).getTime();
}

export function EventSheet({ mode, value, anchor, onChange, onSave, onDelete, onClose }: Props) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [hits, setHits] = useState<MapPlace[]>([]);
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - 340));
  const top = Math.max(12, Math.min(anchor.top, window.innerHeight - 420));
  const mapsHref = value.mapsUrl || (value.location.trim() ? mapsSearchUrl(value.location.trim()) : "");

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = value.location.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setHits([{ label: q, mapsUrl: mapsSearchUrl(q) }]);
    const id = window.setTimeout(() => {
      void searchPlaces(q).then(setHits);
    }, 220);
    return () => window.clearTimeout(id);
  }, [value.location]);

  return (
    <div className="celinen-ios-cal__sheet-back" onClick={onClose}>
      <form
        className="celinen-ios-cal__sheet"
        style={{ top, left }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <input
          ref={titleRef}
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          placeholder="Add Title"
          aria-label="Add Title"
        />
        <input
          value={value.location}
          onChange={(event) => onChange({ ...value, location: event.target.value, mapsUrl: "" })}
          placeholder="Add Location"
          aria-label="Add Location"
          autoComplete="off"
        />
        {hits.length ? (
          <ul className="celinen-ios-cal__places">
            {hits.map((hit) => (
              <li key={hit.mapsUrl + hit.label}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ ...value, location: hit.label, mapsUrl: hit.mapsUrl });
                    setHits([]);
                  }}
                >
                  {hit.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {mapsHref ? (
          <a
            className="celinen-ios-cal__maps"
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            Google Maps
          </a>
        ) : null}
        <label className="celinen-ios-cal__check">
          <span>all-day</span>
          <input
            type="checkbox"
            checked={value.allDay}
            onChange={(event) => onChange({ ...value, allDay: event.target.checked })}
          />
        </label>
        <label>
          <span>starts</span>
          <input
            type="date"
            value={ymd(value.start)}
            onChange={(event) =>
              onChange({ ...value, start: stitch(event.target.value, hm(value.start), value.allDay) })
            }
          />
          {value.allDay ? null : (
            <input
              type="time"
              value={hm(value.start)}
              onChange={(event) =>
                onChange({ ...value, start: stitch(ymd(value.start), event.target.value, false) })
              }
            />
          )}
        </label>
        <label>
          <span>ends</span>
          <input
            type="date"
            value={ymd(value.allDay ? value.end - 1 : value.end)}
            onChange={(event) =>
              onChange({
                ...value,
                end: stitch(event.target.value, hm(value.end), value.allDay, value.allDay),
              })
            }
          />
          {value.allDay ? null : (
            <input
              type="time"
              value={hm(value.end)}
              onChange={(event) =>
                onChange({ ...value, end: stitch(ymd(value.end), event.target.value, false) })
              }
            />
          )}
        </label>
        <div className="celinen-ios-cal__sheet-actions">
          {onDelete ? (
            <button type="button" onClick={onDelete}>
              Delete
            </button>
          ) : null}
          <button type="submit">{mode === "edit" ? "Save" : "Add Event"}</button>
        </div>
      </form>
    </div>
  );
}
