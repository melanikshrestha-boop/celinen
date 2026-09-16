export type MapPlace = {
  label: string;
  mapsUrl: string;
};

export function mapsSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function placeFromMapsPaste(input: string): MapPlace | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (!host.includes("google.") && host !== "maps.app.goo.gl") return null;
    const place = url.pathname.match(/\/place\/([^/]+)/);
    const label = place
      ? decodeURIComponent(place[1].replace(/\+/g, " "))
      : url.searchParams.get("query") || url.searchParams.get("q") || raw;
    return { label, mapsUrl: raw };
  } catch {
    return null;
  }
}

type NominatimHit = { display_name?: string; lat?: string; lon?: string };

async function nominatim(query: string): Promise<MapPlace[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "celinen-calendar/1.0" },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as NominatimHit[];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const label = typeof row.display_name === "string" ? row.display_name : "";
      if (!label || !row.lat || !row.lon) return null;
      return { label, mapsUrl: mapsSearchUrl(`${row.lat},${row.lon}`) };
    })
    .filter((row): row is MapPlace => Boolean(row));
}

type GoogleHit = {
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
};

async function googlePlaces(query: string, key: string): Promise<MapPlace[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.googleMapsUri,places.location",
    },
    body: JSON.stringify({ textQuery: query }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { places?: GoogleHit[] };
  return (body.places ?? [])
    .map((place) => {
      const label = place.formattedAddress || place.displayName?.text || "";
      if (!label) return null;
      const mapsUrl =
        place.googleMapsUri ||
        (place.location
          ? mapsSearchUrl(`${place.location.latitude},${place.location.longitude}`)
          : mapsSearchUrl(label));
      return { label, mapsUrl };
    })
    .filter((row): row is MapPlace => Boolean(row));
}

export async function geocodePlaces(query: string, googleKey = ""): Promise<MapPlace[]> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return [];
  const pasted = placeFromMapsPaste(q);
  if (pasted) return [pasted];
  if (googleKey) {
    const hits = await googlePlaces(q, googleKey);
    if (hits.length) return hits;
  }
  return nominatim(q);
}

export async function searchPlaces(query: string): Promise<MapPlace[]> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return [];
  const pasted = placeFromMapsPaste(q);
  if (pasted) return [pasted];
  try {
    const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { hits?: MapPlace[] };
    return Array.isArray(body.hits) ? body.hits.slice(0, 6) : [];
  } catch {
    return [];
  }
}
