import { useState } from "react";
import type { BookingType } from "@/lib/booking-types";

export function BookingsPanel({
  types,
  onChange,
  onBook,
}: {
  types: BookingType[];
  onChange: (types: BookingType[]) => void;
  onBook: (type: BookingType) => void;
}) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("0");
  const [durationMin, setDurationMin] = useState("60");
  const [location, setLocation] = useState("");

  function add() {
    const name = title.trim();
    if (!name) return;
    onChange([
      ...types,
      {
        id: `type-${Date.now().toString(36)}`,
        title: name,
        price: Math.max(0, Number(price) || 0),
        durationMin: Math.max(15, Number(durationMin) || 60),
        location: location.trim(),
        enabled: true,
      },
    ]);
    setTitle("");
    setPrice("0");
    setDurationMin("60");
    setLocation("");
  }

  return (
    <aside className="celinen-ios-cal__inspect celinen-ios-cal__bookings" aria-label="Bookings">
      <h2>Bookings</h2>
      <p>Session types. Pick one, then click an empty time on the calendar.</p>
      <ul className="celinen-book-list">
        {types.map((type) => (
          <li key={type.id}>
            <button type="button" onClick={() => type.enabled && onBook(type)}>
              <strong>{type.title}</strong>
              <span>
                ${type.price} · {type.durationMin} min
                {type.location ? ` · ${type.location}` : ""}
              </span>
            </button>
            <label>
              <input
                type="checkbox"
                checked={type.enabled}
                onChange={(event) =>
                  onChange(
                    types.map((row) =>
                      row.id === type.id ? { ...row, enabled: event.target.checked } : row,
                    ),
                  )
                }
              />
            </label>
          </li>
        ))}
      </ul>
      <form
        className="celinen-book-new"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Session name" aria-label="Session name" />
        <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="Price" aria-label="Price" />
        <input value={durationMin} onChange={(event) => setDurationMin(event.target.value)} inputMode="numeric" placeholder="Minutes" aria-label="Minutes" />
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" aria-label="Location" />
        <button type="submit">Add type</button>
      </form>
    </aside>
  );
}
