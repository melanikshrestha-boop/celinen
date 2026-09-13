import type { DeliveryState } from "./workflow";

export const activityFilters = ["all", "client", "selections", "feedback", "downloads"] as const;
export type DeliveryActivityFilter = (typeof activityFilters)[number];
export type DeliveryActivityCategory = "delivery" | "selections" | "feedback" | "downloads";
type DeliveryEvent = DeliveryState["events"][number];

export function sharedActivity(events: DeliveryEvent[]): DeliveryEvent[] {
  return events.filter((event) => !event.text.startsWith("Upload reserved"));
}

export function activityCategory(event: DeliveryEvent): DeliveryActivityCategory {
  if (event.text.startsWith("Browser handoff recorded:")) return "downloads";
  if (
    event.text === "Photo selected" ||
    event.text === "Photo deselected" ||
    event.text.endsWith(" selections submitted") ||
    event.text === "Selections reopened" ||
    event.text === "Selection request updated"
  )
    return "selections";
  if (
    event.text.startsWith("Comment added:") ||
    event.text.startsWith("Revision requested:") ||
    event.text.startsWith("Revision marked addressed;") ||
    event.text.startsWith("Exact version approved:")
  )
    return "feedback";
  return "delivery";
}

export function filteredActivity(
  events: DeliveryEvent[],
  filter: DeliveryActivityFilter,
): DeliveryEvent[] {
  const visible = sharedActivity(events);
  if (filter === "all") return visible;
  if (filter === "client") return visible.filter((event) => event.role === "client");
  return visible.filter((event) => activityCategory(event) === filter);
}

function csvCell(value: string): string {
  const protectedValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function deliveryActivityCsv(
  events: DeliveryEvent[],
  filter: DeliveryActivityFilter,
): string {
  const rows = filteredActivity(events, filter).map((event) =>
    [
      event.at,
      event.role === "owner" ? "Photographer" : "Client",
      activityCategory(event),
      event.text,
    ]
      .map(csvCell)
      .join(","),
  );
  return ["Timestamp (UTC)", "Actor", "Category", "Activity"]
    .map(csvCell)
    .join(",")
    .concat("\r\n", rows.join("\r\n"), rows.length ? "\r\n" : "");
}
