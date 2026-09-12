import { createServerFn } from "@tanstack/react-start";
import { isCalendarFeedUrl, normalizeCalendarFeedUrl } from "./calendar-ics";

export const fetchCalendarFeed = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => {
    const url = normalizeCalendarFeedUrl(data.url);
    if (!url || !isCalendarFeedUrl(url)) throw new Error("Use a Google Calendar or Calendar app iCal link.");
    return { url };
  })
  .handler(async ({ data }) => {
    const response = await fetch(data.url, {
      headers: { accept: "text/calendar, text/plain;q=0.9" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error("That calendar link could not be opened.");
    const ics = await response.text();
    if (ics.length > 2_000_000) throw new Error("That calendar is too large to import.");
    if (!ics.includes("BEGIN:VCALENDAR")) throw new Error("That link is not an iCal calendar.");
    return { ics };
  });
