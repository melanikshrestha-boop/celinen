import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contractDraft, EMPTY_CONTRACT_FIELDS, footballServices } from "../src/lib/studio-desk/contract-draft";
import { SESSION_TYPES } from "../src/lib/studio-desk/store";
import { orderedTimeZones, formatTimeZone } from "../src/lib/studio-desk/timezones";
import { destinationPathFor } from "../src/lib/workspace-routing";

describe("studio desk", () => {
  test("detected zone is first and every listed zone is unique", () => {
    const zones = orderedTimeZones("America/Los_Angeles");
    expect(zones[0]).toBe("America/Los_Angeles");
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones.length).toBeGreaterThan(20);
    expect(formatTimeZone("America/Los_Angeles")).toMatch(/Los Angeles/);
  });

  test("session types are college football coverage, not a wedding menu", () => {
    expect(SESSION_TYPES).toContain("Game day");
    expect(SESSION_TYPES).toContain("Sideline");
    expect(SESSION_TYPES).not.toContain("Wedding");
  });

  test("contract draft is football work and not a Pixieset document", () => {
    const body = contractDraft({
      ...EMPTY_CONTRACT_FIELDS,
      photographerName: "Celinen",
      school: "USC",
      opponent: "UCLA",
      photographerEmail: "studio@example.com",
    });
    expect(body).toContain("Not legal advice");
    expect(body).toContain("USC vs UCLA");
    expect(body).toContain("Photography Services Agreement");
    expect(body).toContain("studio@example.com");
    expect(body).not.toMatch(/Pixieset/i);
    expect(footballServices("USC", "UCLA")).toContain("same-night");
  });

  test("chat routes contracts to bookings and invoices to earnings", () => {
    expect(destinationPathFor("sign the game day contract")).toBe("/bookings");
    expect(destinationPathFor("invoice the client for this photo shoot")).toBe("/earnings");
  });

  test("desk chrome uses neon confirm, not a teal Pixieset clone", () => {
    const css = readFileSync(
      new URL("../src/components/studio-desk/studio-desk.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain("--sd-neon: #4d6fff");
    expect(css).not.toMatch(/#00a3a1|#2e9e8f|#1abc9c/i);
  });
});
