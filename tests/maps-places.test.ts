import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mapsSearchUrl, placeFromMapsPaste } from "../src/lib/maps-places";

test("pasted Google Maps URLs become a place", () => {
  const hit = placeFromMapsPaste(
    "https://www.google.com/maps/place/University+of+Southern+California/@34.0224,-118.2851",
  );
  expect(hit?.label).toContain("University of Southern California");
  expect(hit?.mapsUrl).toContain("google.com/maps");
});

test("event sheet asks for title and Google Maps location", () => {
  const source = readFileSync(new URL("../src/components/dashboard/EventSheet.tsx", import.meta.url), "utf8");
  expect(source).toContain('placeholder="Add Title"');
  expect(source).toContain('placeholder="Add Location"');
  expect(source).toContain("searchPlaces");
  expect(source).toContain("Add Event");
});

test("maps search url is a Google Maps query", () => {
  expect(mapsSearchUrl("34.02,-118.28")).toBe(
    "https://www.google.com/maps/search/?api=1&query=34.02%2C-118.28",
  );
});

test("event sheet always has a Google Maps href", () => {
  const source = readFileSync(new URL("../src/components/dashboard/EventSheet.tsx", import.meta.url), "utf8");
  expect(source).toContain("mapsSearchUrl");
  expect(source).toContain("Google Maps");
  expect(source).toContain("celinen-ios-cal__maps");
});
