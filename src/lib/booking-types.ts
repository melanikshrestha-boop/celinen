export type BookingType = {
  id: string;
  title: string;
  price: number;
  durationMin: number;
  location: string;
  enabled: boolean;
};

function key(scope: string) {
  return `celinen.booking.types.v1:${scope}`;
}

export function emptyBookingTypes(): BookingType[] {
  return [];
}

export function readBookingTypes(scope: string): BookingType[] {
  try {
    const raw = localStorage.getItem(key(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.title !== "string") return null;
        const price = Number(item.price);
        const durationMin = Number(item.durationMin);
        return {
          id: item.id.slice(0, 80),
          title: item.title.slice(0, 80),
          price: Number.isFinite(price) ? Math.max(0, price) : 0,
          durationMin: Number.isFinite(durationMin) ? Math.max(15, durationMin) : 60,
          location: typeof item.location === "string" ? item.location.slice(0, 120) : "",
          enabled: item.enabled !== false,
        };
      })
      .filter((item): item is BookingType => Boolean(item))
      .slice(0, 40);
  } catch {
    return [];
  }
}

export function writeBookingTypes(scope: string, types: BookingType[]) {
  localStorage.setItem(key(scope), JSON.stringify(types.slice(0, 40)));
}
