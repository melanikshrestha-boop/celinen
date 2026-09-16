import { expect, test } from "bun:test";
import { formatPlace, placeFromGeo, placeFromZone, regionFromZone } from "../src/lib/calendar-place";

test("Los Angeles zone is California", () => {
  expect(regionFromZone("America/Los_Angeles")).toBe("California");
  expect(regionFromZone("Pacific/Honolulu")).toBe("Hawaii");
});

test("place label always includes state and timezone", () => {
  const place = {
    zone: "America/Los_Angeles",
    tz: "PDT",
    state: "California",
    city: "",
    precise: false,
    asked: false,
  };
  expect(formatPlace(place)).toBe("California · PDT");
  expect(formatPlace({ ...place, city: "Los Angeles", precise: true })).toBe(
    "Los Angeles, California · PDT",
  );
});

test("geo payload fills city and state", () => {
  const prior = placeFromZone();
  const next = placeFromGeo(
    { city: "Los Angeles", principalSubdivision: "California" },
    { ...prior, state: "California", tz: "PDT" },
  );
  expect(next.precise).toBe(true);
  expect(next.city).toBe("Los Angeles");
  expect(formatPlace(next)).toContain("Los Angeles, California");
});
