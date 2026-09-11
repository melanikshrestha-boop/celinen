import { describe, expect, test } from "bun:test";
import {
  captionFromRoster,
  findRosterPerson,
  isEventPeople,
  labelEventPerson,
  parseShorthand,
  peopleOnPhoto,
  photoMatchesWhoQuery,
  shotsOfCluster,
  shotsOfPerson,
  tagPhoto,
  untagPhoto,
  upsertRoster,
} from "../src/lib/studio/people";

const jane = { id: "jane", name: "Jane Doe", number: "23", team: "USC Women's Soccer" };
const melani = { id: "melani", name: "Melani Shrestha", number: "47", team: "Track" };

describe("sports who-is-in-this-photo roster", () => {
  test("jersey shorthand becomes a number the roster can resolve", () => {
    expect(parseShorthand("#23")).toEqual({ number: "23", name: "" });
    expect(parseShorthand("23")).toEqual({ number: "23", name: "" });
    expect(parseShorthand("#23 Jane Doe")).toEqual({ number: "23", name: "Jane Doe" });
    expect(parseShorthand("Jane Doe")).toEqual({ number: "", name: "Jane Doe" });
  });

  test("Photo Mechanic-style #23 maps to the roster name and team", () => {
    const roster = [jane, melani];
    expect(findRosterPerson(roster, "#23")?.name).toBe("Jane Doe");
    expect(captionFromRoster(jane)).toBe("#23 Jane Doe · USC Women's Soccer");
  });

  test("unknown numbers join the roster instead of inventing a face identity", () => {
    const { roster, person } = upsertRoster([jane], { number: "8", name: "", team: "" });
    expect(roster).toHaveLength(2);
    expect(person.name).toBe("#8");
    expect(person.number).toBe("8");
  });

  test("a marathon card can be filtered to one athlete", () => {
    const shots = [
      { id: "a", subjects: [{ personId: "melani", source: "shorthand" as const }] },
      { id: "b", subjects: [{ personId: "jane", source: "roster" as const }] },
      { id: "c", subjects: [{ personId: "melani", source: "roster" as const }] },
    ];
    expect(shotsOfPerson(shots, "melani").map((shot) => shot.id)).toEqual(["a", "c"]);
  });

  test("tagging does not duplicate, and untagging is exact", () => {
    const once = tagPhoto(undefined, jane, "shorthand");
    const twice = tagPhoto(once, jane, "roster");
    expect(twice).toHaveLength(1);
    expect(untagPhoto(twice, "jane")).toEqual([]);
    expect(peopleOnPhoto([jane, melani], twice).map((person) => person.id)).toEqual(["jane"]);
  });

  test("client find-me matches name, bib, or filename — not a face model", () => {
    expect(photoMatchesWhoQuery("Melani", [melani], "DSC_1001.NEF")).toBe(true);
    expect(photoMatchesWhoQuery("#47", [melani], "DSC_1001.NEF")).toBe(true);
    expect(photoMatchesWhoQuery("1001", [jane], "DSC_1001.NEF")).toBe(true);
    expect(photoMatchesWhoQuery("Jane", [melani], "DSC_1001.NEF")).toBe(false);
  });

  test("event-local clusters stay unlabeled until the photographer names them", () => {
    const cluster = {
      id: "person-12",
      label: "",
      role: "unlabeled" as const,
      confirmed: false,
      frameIds: ["a", "c"],
      observationIds: ["a:face:0", "c:face:0"],
      source: "local-descriptor" as const,
      minSimilarity: 0.84,
    };
    expect(isEventPeople([cluster])).toBe(true);
    expect(isEventPeople([{ ...cluster, id: "Jane" }])).toBe(false);
    const named = labelEventPerson([cluster], "person-12", { label: "Jane Doe", role: "priority" });
    expect(named[0]?.confirmed).toBe(true);
    expect(named[0]?.label).toBe("Jane Doe");
    const shots = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(shotsOfCluster(shots, cluster).map((shot) => shot.id)).toEqual(["a", "c"]);
  });
});
