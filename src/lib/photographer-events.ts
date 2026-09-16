/** Live sports calendars for photographers looking for the next shoot. */

export type PhotographerEvent = {
  when: string;
  title: string;
  league: string;
  venue: string;
  city: string;
};

const TDB = "https://www.thesportsdb.com/api/v1/json/3";
const UA = "Celinen/1.0 (photographer event search)";

export function wantsEventSearch(text: string): boolean {
  const value = text.toLowerCase();
  if (
    !/\b(events?|games?|gigs?|shoots?|sideline|fixtures?|schedule|bookings?)\b/.test(value)
  )
    return false;
  return /\b(find|found|looking|need|help|upcoming|don't|dont|got no|no upcoming|where|when|any)\b/.test(
    value,
  );
}

export function sportsEventSystemPrompt(role: string, brief: string, at: string): string {
  const who =
    role === "college-football"
      ? "college football photographer"
      : "sports photographer";
  return `This user is a ${who}. They asked for real upcoming shoots, not a brainstorm.
LIVE SPORTS pulled ${at} from public league calendars:
${brief || "(no games returned)"}
Rules:
- Use only this list. Never invent a match, venue, or time.
- Answer as a sideline shooter: date, match, venue, city, then how to work it (arrive early, media creds, peak action).
- Prefer NCAA and NFL when both exist.
- No markdown asterisks or numbered hashes. Line breaks and dashes only.
- If the list is empty, say the live calendar did not return games. Do not invent.`;
}

function json(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson(url: string, fetchImpl: typeof fetch, signal: AbortSignal) {
  const response = await fetchImpl(url, { signal, headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`calendar ${response.status}`);
  return response.json();
}

function fromTheSportsDb(raw: unknown): PhotographerEvent[] {
  const events = json(raw).events;
  if (!Array.isArray(events)) return [];
  const out: PhotographerEvent[] = [];
  for (const item of events) {
    const row = json(item);
    const title = text(row.strEvent);
    const when = text(row.dateEvent) || text(row.strTimestamp);
    if (!title || !when) continue;
    out.push({
      when: text(row.strTimestamp) || `${when}T${text(row.strTimeLocal) || text(row.strTime) || "00:00:00"}`,
      title,
      league: text(row.strLeague) || "Sports",
      venue: text(row.strVenue),
      city: text(row.strCity) || text(row.strCountry),
    });
  }
  return out;
}

function fromMlb(raw: unknown): PhotographerEvent[] {
  const dates = json(raw).dates;
  if (!Array.isArray(dates)) return [];
  const out: PhotographerEvent[] = [];
  for (const day of dates) {
    const games = json(day).games;
    if (!Array.isArray(games)) continue;
    for (const game of games) {
      const row = json(game);
      const teams = json(row.teams);
      const away = text(json(json(teams.away).team).name);
      const home = text(json(json(teams.home).team).name);
      const when = text(row.gameDate) || text(row.officialDate);
      if (!away || !home || !when) continue;
      out.push({
        when,
        title: `${away} vs ${home}`,
        league: "MLB",
        venue: text(json(row.venue).name),
        city: text(json(json(row.venue).location).city),
      });
    }
  }
  return out;
}

function fromNhl(raw: unknown): PhotographerEvent[] {
  const week = json(raw).gameWeek;
  if (!Array.isArray(week)) return [];
  const out: PhotographerEvent[] = [];
  for (const day of week) {
    const games = json(day).games;
    if (!Array.isArray(games)) continue;
    for (const game of games) {
      const row = json(game);
      const home = json(row.homeTeam);
      const away = json(row.awayTeam);
      const homeName = `${text(json(home.placeName).default)} ${text(json(home.commonName).default)}`.trim();
      const awayName = `${text(json(away.placeName).default)} ${text(json(away.commonName).default)}`.trim();
      const when = text(row.startTimeUTC);
      if (!homeName || !awayName || !when) continue;
      const venue = json(row.venue);
      out.push({
        when,
        title: `${awayName} vs ${homeName}`,
        league: "NHL",
        venue: text(venue.default) || text(venue.name),
        city: "",
      });
    }
  }
  return out;
}

export function formatLiveSportsBrief(events: readonly PhotographerEvent[], limit = 12): string {
  const seen = new Set<string>();
  const rows = [...events]
    .sort((a, b) => a.when.localeCompare(b.when))
    .filter((event) => {
      const key = `${event.when.slice(0, 10)}|${event.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  return rows
    .map((event) => {
      const day = event.when.slice(0, 10);
      const place = [event.venue, event.city].filter(Boolean).join(", ");
      return `- ${day} — ${event.league} — ${event.title}${place ? ` — ${place}` : ""}`;
    })
    .join("\n");
}

function dayStamps(count: number, now = new Date()): string[] {
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const stamp = new Date(now.getTime() + i * 86_400_000);
    days.push(stamp.toISOString().slice(0, 10));
  }
  return days;
}

export async function loadLiveSportsBrief(
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const days = dayStamps(8, now);
  const urls = [
    ...days.map((day) => `${TDB}/eventsday.php?d=${day}&s=American%20Football`),
    `${TDB}/eventsnextleague.php?id=4479`,
    `${TDB}/eventsnextleague.php?id=4391`,
    `${TDB}/eventsnextleague.php?id=4387`,
    `${TDB}/eventsnextleague.php?id=4346`,
    "https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=venue,team",
    "https://api-web.nhle.com/v1/schedule/now",
  ];
  try {
    const settled = await Promise.allSettled(
      urls.map((url) => readJson(url, fetchImpl, controller.signal)),
    );
    const events: PhotographerEvent[] = [];
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      events.push(...fromTheSportsDb(item.value), ...fromMlb(item.value), ...fromNhl(item.value));
    }
    return formatLiveSportsBrief(events);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
