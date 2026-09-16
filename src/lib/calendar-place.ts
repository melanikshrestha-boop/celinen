import { detectTimeZone } from "./studio-desk/timezones";

export type CalendarPlace = {
  zone: string;
  tz: string;
  state: string;
  city: string;
  precise: boolean;
  asked: boolean;
};

const STORE = "celinen.calendar.place.v1";

const ZONE_REGION: Record<string, string> = {
  "America/Los_Angeles": "California",
  "America/Vancouver": "British Columbia",
  "America/Phoenix": "Arizona",
  "America/Denver": "Colorado",
  "America/Boise": "Idaho",
  "America/Chicago": "Illinois",
  "America/New_York": "New York",
  "America/Detroit": "Michigan",
  "America/Indiana/Indianapolis": "Indiana",
  "America/Kentucky/Louisville": "Kentucky",
  "America/Anchorage": "Alaska",
  "Pacific/Honolulu": "Hawaii",
  "America/Toronto": "Ontario",
  "America/Mexico_City": "Mexico City",
};

export function shortTimeZone(at = new Date(), zone = detectTimeZone()): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

export function regionFromZone(zone = detectTimeZone()): string {
  if (ZONE_REGION[zone]) return ZONE_REGION[zone];
  const city = zone.split("/").pop()?.replace(/_/g, " ") ?? "";
  return city;
}

export function placeFromZone(at = new Date()): CalendarPlace {
  const zone = detectTimeZone();
  return {
    zone,
    tz: shortTimeZone(at, zone),
    state: regionFromZone(zone),
    city: "",
    precise: false,
    asked: false,
  };
}

export function formatPlace(place: CalendarPlace): string {
  const where =
    place.precise && place.city && place.state
      ? `${place.city}, ${place.state}`
      : place.state || place.city;
  return [where, place.tz].filter(Boolean).join(" · ");
}

export function readCalendarPlace(): CalendarPlace | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const row = JSON.parse(raw) as Partial<CalendarPlace>;
    if (!row || typeof row !== "object") return null;
    const base = placeFromZone();
    return {
      zone: typeof row.zone === "string" ? row.zone : base.zone,
      tz: typeof row.tz === "string" ? row.tz : base.tz,
      state: typeof row.state === "string" ? row.state : base.state,
      city: typeof row.city === "string" ? row.city : "",
      precise: row.precise === true,
      asked: row.asked === true,
    };
  } catch {
    return null;
  }
}

export function writeCalendarPlace(place: CalendarPlace) {
  try {
    localStorage.setItem(STORE, JSON.stringify(place));
  } catch {
    /* private mode */
  }
}

type GeoName = {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
};

export function placeFromGeo(row: GeoName, prior: CalendarPlace): CalendarPlace {
  const state = (row.principalSubdivision || prior.state).trim();
  const city = (row.city || row.locality || "").trim();
  return {
    ...prior,
    state: state || prior.state,
    city,
    precise: Boolean(city && state),
  };
}

export async function lookupPlace(coords?: { latitude: number; longitude: number }): Promise<GeoName | null> {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("localityLanguage", "en");
  if (coords) {
    url.searchParams.set("latitude", String(coords.latitude));
    url.searchParams.set("longitude", String(coords.longitude));
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return (await res.json()) as GeoName;
}
