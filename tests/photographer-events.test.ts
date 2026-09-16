import { describe, expect, test } from "bun:test";
import {
  formatLiveSportsBrief,
  loadLiveSportsBrief,
  sportsEventSystemPrompt,
  wantsEventSearch,
} from "../src/lib/photographer-events";

describe("sports photographer event search", () => {
  test("detects gig hunting, not lighting chat", () => {
    expect(
      wantsEventSearch("I dont got upcoming shoots help me find some events"),
    ).toBe(true);
    expect(wantsEventSearch("find me games this weekend")).toBe(true);
    expect(wantsEventSearch("Where should I shoot tomorrow?")).toBe(true);
    expect(wantsEventSearch("check the lighting for a night portrait")).toBe(false);
    expect(wantsEventSearch("Plan a shoot")).toBe(false);
  });

  test("formats live games without inventing rows", () => {
    const brief = formatLiveSportsBrief([
      {
        when: "2026-09-19T00:00:00",
        title: "Texas Tech vs Houston",
        league: "NCAA Division 1 Football",
        venue: "Jones AT&T Stadium",
        city: "United States",
      },
      {
        when: "2026-09-20T17:00:00Z",
        title: "Atlanta Falcons vs Carolina Panthers",
        league: "NFL",
        venue: "Mercedes-Benz Stadium",
        city: "",
      },
    ]);
    expect(brief).toContain("Texas Tech vs Houston");
    expect(brief).toContain("Jones AT&T Stadium");
    expect(brief).toContain("NFL — Atlanta Falcons vs Carolina Panthers");
    expect(sportsEventSystemPrompt("sports", brief, "2026-09-16T12:00:00Z")).toContain(
      "Never invent a match",
    );
    expect(sportsEventSystemPrompt("sports", brief, "2026-09-16T12:00:00Z")).toContain(
      "sports photographer",
    );
  });

  test("loadLiveSportsBrief reads public calendars through fetch", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("eventsday") && url.includes("2026-09-19"))
        return Response.json({
          events: [
            {
              strEvent: "Texas Tech vs Houston",
              strLeague: "NCAA Division 1 Football",
              dateEvent: "2026-09-19",
              strTimestamp: "2026-09-19T00:00:00",
              strVenue: "Jones AT&T Stadium",
              strCountry: "United States",
            },
          ],
        });
      if (url.includes("statsapi.mlb.com"))
        return Response.json({
          dates: [
            {
              games: [
                {
                  gameDate: "2026-09-16T23:10:00Z",
                  teams: {
                    away: { team: { name: "Los Angeles Dodgers" } },
                    home: { team: { name: "Cincinnati Reds" } },
                  },
                  venue: { name: "Great American Ball Park", location: { city: "Cincinnati" } },
                },
              ],
            },
          ],
        });
      return Response.json({ events: [] });
    }) as typeof fetch;
    const brief = await loadLiveSportsBrief(fetchImpl, new Date("2026-09-16T12:00:00Z"));
    expect(calls.some((url) => url.includes("thesportsdb.com"))).toBe(true);
    expect(calls.some((url) => url.includes("statsapi.mlb.com"))).toBe(true);
    expect(brief).toContain("Texas Tech vs Houston");
    expect(brief).toContain("Los Angeles Dodgers vs Cincinnati Reds");
  });
});
