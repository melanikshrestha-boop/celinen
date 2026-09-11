/** IANA zones the product can schedule in. Browser list first; fallback is still global. */
const FALLBACK = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function allTimeZones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const values = Intl.supportedValuesOf("timeZone");
      if (values.length) return [...values];
    }
  } catch {
    /* keep fallback */
  }
  return [...FALLBACK];
}

export function orderedTimeZones(preferred = detectTimeZone()): string[] {
  const all = allTimeZones();
  const known = new Set(all);
  const head = [
    preferred,
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "UTC",
  ].filter((zone, index, list) => known.has(zone) && list.indexOf(zone) === index);
  const rest = all.filter((zone) => !head.includes(zone));
  return [...head, ...rest];
}

export function formatTimeZone(zone: string, at = new Date()): string {
  let offset = "GMT";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    offset = parts.find((part) => part.type === "timeZoneName")?.value?.replace("GMT", "GMT") ?? "GMT";
    if (offset === "GMT") offset = "GMT+00:00";
    if (/^GMT[+-]\d$/.test(offset)) offset = `${offset.slice(0, 4)}0${offset.slice(4)}:00`;
    if (/^GMT[+-]\d{2}$/.test(offset)) offset = `${offset}:00`;
  } catch {
    offset = "GMT";
  }
  const city = zone.replace(/_/g, " ").split("/").slice(1).join(", ") || zone;
  return `(${offset}) ${city}`;
}

export function formatInZone(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
