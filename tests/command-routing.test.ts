import { describe, expect, test } from "bun:test";
import { destinationPathFor } from "../src/lib/workspace-routing";

describe("workspace command routing", () => {
  test("strong actions beat incidental video and client nouns", () => {
    expect(destinationPathFor("send these video clips to the client")).toBe("/deliver");
    expect(destinationPathFor("invoice the client for this photo shoot")).toBe("/earnings");
    expect(destinationPathFor("show revenue from video deliveries")).toBe("/earnings");
    expect(destinationPathFor("sync these video selects to Lightroom")).toBe("/adobe");
  });

  test("media review commands still reach their benches", () => {
    expect(destinationPathFor("review these video clips")).toBe("/video");
    expect(destinationPathFor("open the premiere timeline")).toBe("/video");
    expect(destinationPathFor("cull the strongest RAW photos")).toBe("/studio");
    expect(destinationPathFor("post this to instagram")).toBe("/publish");
  });

  test("contracts and session bookings open the bookings desk", () => {
    expect(destinationPathFor("open the sideline contract")).toBe("/bookings");
    expect(destinationPathFor("college football session types")).toBe("/bookings");
  });
});
