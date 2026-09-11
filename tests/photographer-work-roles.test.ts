import { describe, expect, test } from "bun:test";
import {
  PHOTOGRAPHER_WORK_ROLES,
  dashboardGreetingFor,
  isPhotographerWorkRole,
  profileSeedFromWorkRole,
  workDestinationsFor,
} from "../src/lib/photographer-work-roles";

describe("photographer first-login roles", () => {
  test("college football is first and every chip is a known role", () => {
    expect(PHOTOGRAPHER_WORK_ROLES[0]?.id).toBe("college-football");
    expect(PHOTOGRAPHER_WORK_ROLES.map((role) => role.id)).toEqual([
      "college-football",
      "sports",
      "wedding",
      "portrait",
      "editorial",
      "student",
      "hobbyist",
      "other",
    ]);
    expect(isPhotographerWorkRole("college-football")).toBe(true);
    expect(isPhotographerWorkRole("admin")).toBe(false);
    expect(isPhotographerWorkRole("youtuber")).toBe(false);
  });

  test("roles seed private specialties without inventing taxonomy ids", () => {
    expect(profileSeedFromWorkRole("college-football")).toEqual({
      specialties: ["sports"],
      customSpecialty: "",
    });
    expect(profileSeedFromWorkRole("wedding")).toEqual({
      specialties: ["wedding"],
      customSpecialty: "",
    });
    expect(profileSeedFromWorkRole("student")).toEqual({ specialties: [], customSpecialty: "" });
    expect(profileSeedFromWorkRole("other")).toEqual({
      specialties: ["other"],
      customSpecialty: "",
    });
  });

  test("dashboard greeting and work order follow the saved role", () => {
    expect(dashboardGreetingFor(undefined)).toBe("What should we work on?");
    expect(dashboardGreetingFor("hobbyist")).toBe("What should we work on?");
    expect(dashboardGreetingFor("college-football")).toBe("What's the next game?");
    expect(dashboardGreetingFor("wedding")).toBe("What's the next wedding?");
    const items = [
      { to: "/shoots" },
      { to: "/earnings" },
      { to: "/bookings" },
    ];
    expect(workDestinationsFor(undefined, items).map((item) => item.to)).toEqual([
      "/shoots",
      "/earnings",
      "/bookings",
    ]);
    expect(workDestinationsFor("college-football", items).map((item) => item.to)).toEqual([
      "/bookings",
      "/shoots",
      "/earnings",
    ]);
  });
});
