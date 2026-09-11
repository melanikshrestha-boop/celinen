/** First-login “Who are you?” chips. Presentation only — never authorization. */

export const PHOTOGRAPHER_WORK_ROLES = [
  { id: "college-football", label: "College football", specialties: ["sports"] },
  { id: "sports", label: "Sports", specialties: ["sports"] },
  { id: "wedding", label: "Wedding", specialties: ["wedding"] },
  { id: "portrait", label: "Portrait", specialties: ["portrait"] },
  { id: "editorial", label: "Editorial", specialties: ["editorial"] },
  { id: "student", label: "Student", specialties: [] },
  { id: "hobbyist", label: "Hobbyist", specialties: [] },
  { id: "other", label: "Other", specialties: ["other"] },
] as const;

export type PhotographerWorkRole = (typeof PHOTOGRAPHER_WORK_ROLES)[number]["id"];

const ids = new Set<string>(PHOTOGRAPHER_WORK_ROLES.map((role) => role.id));

export const isPhotographerWorkRole = (value: string): value is PhotographerWorkRole =>
  ids.has(value);

export function profileSeedFromWorkRole(role: PhotographerWorkRole) {
  const match = PHOTOGRAPHER_WORK_ROLES.find((item) => item.id === role)!;
  return { specialties: [...match.specialties], customSpecialty: "" };
}

export function dashboardGreetingFor(role: PhotographerWorkRole | undefined) {
  switch (role) {
    case "college-football":
    case "sports":
      return "What's the next game?";
    case "wedding":
      return "What's the next wedding?";
    case "portrait":
      return "What's the next session?";
    case "editorial":
      return "What's the next assignment?";
    default:
      return "What should we work on?";
  }
}

export function workDestinationsFor<T extends { to: string }>(
  role: PhotographerWorkRole | undefined,
  items: readonly T[],
): T[] {
  if (role !== "college-football" && role !== "sports" && role !== "wedding") return [...items];
  const bookings = items.find((item) => item.to === "/bookings");
  if (!bookings) return [...items];
  return [bookings, ...items.filter((item) => item.to !== "/bookings")];
}
