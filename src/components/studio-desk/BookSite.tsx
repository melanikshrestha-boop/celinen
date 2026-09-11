import { useMemo, useState } from "react";
import { readPublicDesk } from "@/lib/studio-desk/store";
import { detectTimeZone, formatInZone, formatTimeZone, orderedTimeZones } from "@/lib/studio-desk/timezones";
import "./studio-desk.css";

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: first + days }, (_, i) => (i < first ? null : i - first + 1));
}

export function BookSite() {
  const snap = readPublicDesk();
  const visitor = detectTimeZone();
  const [viewZone, setViewZone] = useState(visitor);
  const zones = useMemo(() => orderedTimeZones(visitor), [visitor]);
  const now = new Date();
  const cells = monthCells(now.getFullYear(), now.getMonth());

  return (
    <main className="studio-desk">
      <h1>Book</h1>
      <label style={{ maxWidth: 420, margin: "18px 0 24px" }}>
        Time zone
        <select value={viewZone} onChange={(event) => setViewZone(event.target.value)}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {formatTimeZone(zone)}
            </option>
          ))}
        </select>
      </label>
      <p className="studio-desk__muted">Photographer zone {formatTimeZone(snap.timezone)}</p>
      <div className="studio-desk__grid" style={{ margin: "20px 0" }}>
        {snap.types.map((type) => (
          <div key={type} className="studio-desk__tile">
            {type}
          </div>
        ))}
      </div>
      <h2>{now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: viewZone })}</h2>
      <div className="studio-desk__cal-week">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="studio-desk__cal-grid">
        {cells.map((day, index) => {
          const rows = snap.sessions.filter((session) => {
            const parts = new Intl.DateTimeFormat("en-US", {
              timeZone: viewZone,
              day: "numeric",
              month: "numeric",
              year: "numeric",
            }).formatToParts(new Date(session.startIso));
            return (
              day !== null &&
              Number(parts.find((part) => part.type === "day")?.value) === day &&
              Number(parts.find((part) => part.type === "month")?.value) === now.getMonth() + 1 &&
              Number(parts.find((part) => part.type === "year")?.value) === now.getFullYear()
            );
          });
          return (
            <div key={index} className={day ? "studio-desk__cal-day" : undefined}>
              {day ? <span>{day}</span> : null}
              {rows.map((row) => (
                <a
                  key={row.id}
                  href={`mailto:?subject=${encodeURIComponent(row.title)}&body=${encodeURIComponent(
                    `${row.title}\n${formatInZone(row.startIso, viewZone)} (${formatTimeZone(viewZone)})\nPhotographer: ${formatInZone(row.startIso, snap.timezone)} (${formatTimeZone(snap.timezone)})`,
                  )}`}
                >
                  {row.title}
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </main>
  );
}
