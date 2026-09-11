/** Who is in a photograph: roster + jersey/bib tags. Identity is not inferred from a face box. */

export type RosterPerson = {
  id: string;
  name: string;
  number: string;
  team: string;
};

export type PhotoSubject = {
  personId: string;
  source: "roster" | "shorthand" | "cluster";
};

export type EventPersonRole = "unlabeled" | "couple" | "parent" | "priority" | "guest";

/** Event-local person group. A cluster id is not a name until the photographer confirms it. */
export type EventPerson = {
  id: string;
  label: string;
  role: EventPersonRole;
  confirmed: boolean;
  frameIds: string[];
  observationIds: string[];
  source: "insightface" | "local-descriptor";
  minSimilarity: number;
};

export type Shorthand = {
  number: string;
  name: string;
};

const NUMBER = /(?:#\s*)?(\d{1,4})\b/;

export function parseShorthand(raw: string): Shorthand {
  const text = raw.trim().replace(/\s+/g, " ");
  const numbered = text.match(NUMBER);
  const number = numbered?.[1] ?? "";
  const name = text
    .replace(NUMBER, " ")
    .replace(/[#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { number, name };
}

export function personLabel(person: RosterPerson): string {
  const number = person.number.trim();
  const name = person.name.trim();
  if (number && name && name !== `#${number}`) return `#${number} ${name}`;
  if (number) return `#${number}`;
  return name;
}

export function matchesPerson(person: RosterPerson, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const { number, name } = parseShorthand(q);
  if (number && person.number === number) return true;
  if (name && person.name.toLowerCase().includes(name.toLowerCase())) return true;
  if (!number && !name && personLabel(person).toLowerCase().includes(q)) return true;
  return false;
}

export function findRosterPerson(
  roster: readonly RosterPerson[],
  query: string,
): RosterPerson | undefined {
  const { number, name } = parseShorthand(query);
  if (number) {
    const byNumber = roster.find((person) => person.number === number);
    if (byNumber) return byNumber;
  }
  if (name) {
    const exact = roster.find((person) => person.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    return roster.find((person) => person.name.toLowerCase().includes(name.toLowerCase()));
  }
  return undefined;
}

export function captionFromRoster(person: RosterPerson): string {
  const parts = [personLabel(person)];
  if (person.team.trim()) parts.push(person.team.trim());
  return parts.join(" · ");
}

export function newRosterPerson(partial: Partial<RosterPerson> = {}): RosterPerson {
  const number = (partial.number ?? "").replace(/\D/g, "").slice(0, 4);
  const name = (partial.name ?? "").trim() || (number ? `#${number}` : "");
  return {
    id: partial.id ?? `person-${number || "x"}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    number,
    team: (partial.team ?? "").trim(),
  };
}

export function upsertRoster(
  roster: readonly RosterPerson[],
  draft: Shorthand & { team?: string },
): { roster: RosterPerson[]; person: RosterPerson } {
  const existing = findRosterPerson(roster, draft.number ? `#${draft.number}` : draft.name);
  if (existing) {
    const person: RosterPerson = {
      ...existing,
      name: draft.name || existing.name,
      number: draft.number || existing.number,
      team: draft.team?.trim() || existing.team,
    };
    return {
      roster: roster.map((row) => (row.id === person.id ? person : row)),
      person,
    };
  }
  const person = newRosterPerson(draft);
  return { roster: [...roster, person], person };
}

export function tagPhoto(
  subjects: readonly PhotoSubject[] | undefined,
  person: RosterPerson,
  source: PhotoSubject["source"],
): PhotoSubject[] {
  const next = [...(subjects ?? [])];
  if (next.some((row) => row.personId === person.id)) return next;
  next.push({ personId: person.id, source });
  return next;
}

export function untagPhoto(
  subjects: readonly PhotoSubject[] | undefined,
  personId: string,
): PhotoSubject[] {
  return (subjects ?? []).filter((row) => row.personId !== personId);
}

export function peopleOnPhoto(
  roster: readonly RosterPerson[],
  subjects: readonly PhotoSubject[] | undefined,
): RosterPerson[] {
  const ids = new Set((subjects ?? []).map((row) => row.personId));
  return roster.filter((person) => ids.has(person.id));
}

export function shotsOfPerson<T extends { subjects?: readonly PhotoSubject[] | undefined }>(
  shots: readonly T[],
  personId: string,
): T[] {
  return shots.filter((shot) => shot.subjects?.some((row) => row.personId === personId));
}

export function photoMatchesWhoQuery(
  query: string,
  people: readonly RosterPerson[],
  filename: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (filename.toLowerCase().includes(q)) return true;
  return people.some((person) => matchesPerson(person, query));
}

export function isRoster(value: unknown): value is RosterPerson[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof row.id === "string" &&
      row.id &&
      typeof row.name === "string" &&
      typeof row.number === "string" &&
      typeof row.team === "string",
  );
}

const EVENT_ROLES = new Set<EventPersonRole>(["unlabeled", "couple", "parent", "priority", "guest"]);

export function isEventPeople(value: unknown): value is EventPerson[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof row.id === "string" &&
      /^person-\d+$/.test(row.id) &&
      typeof row.label === "string" &&
      EVENT_ROLES.has(row.role) &&
      typeof row.confirmed === "boolean" &&
      Array.isArray(row.frameIds) &&
      row.frameIds.every((id: unknown) => typeof id === "string") &&
      Array.isArray(row.observationIds) &&
      row.observationIds.every((id: unknown) => typeof id === "string") &&
      (row.source === "insightface" || row.source === "local-descriptor") &&
      typeof row.minSimilarity === "number",
  );
}

export function labelEventPerson(
  people: readonly EventPerson[],
  personId: string,
  draft: { label: string; role?: EventPersonRole },
): EventPerson[] {
  return people.map((person) =>
    person.id === personId
      ? {
          ...person,
          label: draft.label.trim(),
          role: draft.role ?? person.role,
          confirmed: Boolean(draft.label.trim()),
        }
      : person,
  );
}

export function shotsOfCluster<T extends { id: string }>(
  shots: readonly T[],
  person: EventPerson,
): T[] {
  const ids = new Set(person.frameIds);
  return shots.filter((shot) => ids.has(shot.id));
}
