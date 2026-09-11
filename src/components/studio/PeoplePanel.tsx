import { useState } from "react";
import type { Shot } from "@/lib/imaging";
import {
  captionFromRoster,
  labelEventPerson,
  parseShorthand,
  peopleOnPhoto,
  personLabel,
  shotsOfCluster,
  shotsOfPerson,
  tagPhoto,
  untagPhoto,
  upsertRoster,
  type EventPerson,
  type RosterPerson,
} from "@/lib/studio/people";
import "./people-panel.css";

export function PeoplePanel({
  roster,
  eventPeople,
  shots,
  selected,
  personFilter,
  clusterFilter,
  grouping,
  packNote,
  onRoster,
  onTag,
  onFilter,
  onClusterFilter,
  onEventPeople,
  onGroupFaces,
  onProposeGallery,
}: {
  roster: readonly RosterPerson[];
  eventPeople: readonly EventPerson[];
  shots: readonly Shot[];
  selected: Shot | null;
  personFilter: string | null;
  clusterFilter: string | null;
  grouping: boolean;
  packNote: string;
  onRoster: (roster: RosterPerson[]) => void;
  onTag: (shotId: string, subjects: Shot["subjects"]) => void;
  onFilter: (personId: string | null) => void;
  onClusterFilter: (personId: string | null) => void;
  onEventPeople: (people: EventPerson[]) => void;
  onGroupFaces: () => void;
  onProposeGallery: () => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const [rosterDraft, setRosterDraft] = useState("");
  const [clusterDraft, setClusterDraft] = useState<Record<string, string>>({});
  const tagged = selected ? peopleOnPhoto(roster, selected.subjects) : [];
  const faces = selected?.faces?.count;
  const selectedClusters = eventPeople.filter((person) =>
    selected ? person.frameIds.includes(selected.id) : false,
  );

  const apply = (raw: string, toPhoto: boolean, clear: (value: string) => void) => {
    const parsed = parseShorthand(raw);
    if (!parsed.number && !parsed.name) return;
    const next = upsertRoster(roster, parsed);
    onRoster(next.roster);
    if (toPhoto && selected)
      onTag(selected.id, tagPhoto(selected.subjects, next.person, "shorthand"));
    clear("");
  };

  const confirmCluster = (person: EventPerson) => {
    const raw = (clusterDraft[person.id] ?? person.label).trim();
    if (!raw) return;
    const parsed = parseShorthand(raw);
    const nextRoster = upsertRoster(roster, parsed);
    onRoster(nextRoster.roster);
    onEventPeople(
      labelEventPerson(eventPeople, person.id, {
        label: personLabel(nextRoster.person),
        role: person.role === "unlabeled" ? "guest" : person.role,
      }),
    );
    for (const shot of shotsOfCluster(shots, person)) {
      onTag(shot.id, tagPhoto(shot.subjects, nextRoster.person, "cluster"));
    }
    setClusterDraft((current) => ({ ...current, [person.id]: "" }));
  };

  return (
    <section className="studio-people" aria-labelledby="studio-people-heading">
      <h2 id="studio-people-heading">Who is in this photo</h2>
      <p className="studio-people__note">
        Jersey or bib first. Grouping is event-local Person 12, not a name. InsightFace matching
        math is in the C++ engine. Buffalo weights are not shipped.
      </p>

      <div className="studio-people__actions">
        <button type="button" onClick={onGroupFaces} disabled={grouping || shots.length === 0}>
          {grouping ? "Grouping faces…" : "Group faces in this job"}
        </button>
        <button type="button" onClick={onProposeGallery} disabled={shots.length === 0}>
          Propose gallery
        </button>
      </div>
      <p className="studio-people__note">{packNote}</p>

      {selected && (
        <div className="studio-people__shot">
          <p>
            This frame
            {typeof faces === "number" ? ` · ${faces} face${faces === 1 ? "" : "s"} detected` : ""}
            {selectedClusters.length
              ? ` · ${selectedClusters.map((person) => person.label || person.id).join(", ")}`
              : ""}
          </p>
          {tagged.length ? (
            <ul>
              {tagged.map((person) => (
                <li key={person.id}>
                  <button type="button" onClick={() => onFilter(person.id)}>
                    {personLabel(person)}
                    {person.team ? ` · ${person.team}` : ""}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${personLabel(person)}`}
                    onClick={() => onTag(selected.id, untagPhoto(selected.subjects, person.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No one tagged yet.</p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply(tagDraft, true, setTagDraft);
            }}
          >
            <label htmlFor="studio-people-tag">Tag jersey, bib, or name</label>
            <input
              id="studio-people-tag"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="#23 Jane Doe"
              autoComplete="off"
            />
            <button type="submit">Tag</button>
          </form>
        </div>
      )}

      {eventPeople.length > 0 && (
        <div className="studio-people__clusters">
          <p>Event-local groups</p>
          <ul>
            {eventPeople.map((person) => {
              const count = shotsOfCluster(shots, person).length;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    aria-pressed={clusterFilter === person.id}
                    onClick={() => onClusterFilter(clusterFilter === person.id ? null : person.id)}
                  >
                    {person.label || person.id}
                    {person.confirmed ? "" : " · unlabeled"} · {count}
                  </button>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      confirmCluster(person);
                    }}
                  >
                    <label htmlFor={`studio-people-cluster-${person.id}`}>Name this person</label>
                    <input
                      id={`studio-people-cluster-${person.id}`}
                      value={clusterDraft[person.id] ?? person.label}
                      onChange={(event) =>
                        setClusterDraft((current) => ({
                          ...current,
                          [person.id]: event.target.value,
                        }))
                      }
                      placeholder="#23 Jane Doe"
                      autoComplete="off"
                    />
                    <button type="submit">Name</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="studio-people__roster">
        <p>Roster</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply(rosterDraft, false, setRosterDraft);
          }}
        >
          <label htmlFor="studio-people-roster">Add to roster without tagging</label>
          <input
            id="studio-people-roster"
            value={rosterDraft}
            onChange={(event) => setRosterDraft(event.target.value)}
            placeholder="#47 Melani Shrestha"
            autoComplete="off"
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          <li>
            <button
              type="button"
              aria-pressed={personFilter === null && clusterFilter === null}
              onClick={() => {
                onFilter(null);
                onClusterFilter(null);
              }}
            >
              All frames · {shots.length}
            </button>
          </li>
          {roster.map((person) => {
            const count = shotsOfPerson(shots, person.id).length;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  aria-pressed={personFilter === person.id}
                  onClick={() => onFilter(person.id)}
                >
                  {personLabel(person)}
                  {person.team ? ` · ${person.team}` : ""} · {count}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function peopleCaption(roster: readonly RosterPerson[], shot: Shot): string {
  return peopleOnPhoto(roster, shot.subjects).map(captionFromRoster).join("; ");
}
