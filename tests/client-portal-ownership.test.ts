import { describe, expect, test } from "bun:test";
import {
  clientClaimEmailMatches,
  escapeClientEmailPattern,
  isOwnedByStudio,
} from "../src/lib/client-portal-ownership";

describe("cloud client-portal studio ownership", () => {
  test("permits only an exact authenticated studio owner", () => {
    expect(isOwnedByStudio("studio-a", { user_id: "studio-a" })).toBe(true);
    expect(isOwnedByStudio("studio-b", { user_id: "studio-a" })).toBe(false);
    expect(isOwnedByStudio("studio-a", { user_id: "STUDIO-A" })).toBe(false);
    expect(isOwnedByStudio("studio-a", { user_id: "studio-a " })).toBe(false);
  });

  test("never treats unassigned guest intake as shared or claimable", () => {
    expect(isOwnedByStudio("studio-a", { user_id: null })).toBe(false);
    expect(isOwnedByStudio("studio-b", { user_id: null })).toBe(false);
  });

  test("fails closed for missing auth, missing rows and zero-row updates", () => {
    expect(isOwnedByStudio(undefined, { user_id: null })).toBe(false);
    expect(isOwnedByStudio(null, { user_id: null })).toBe(false);
    expect(isOwnedByStudio("", { user_id: "" })).toBe(false);
    expect(isOwnedByStudio(" ", { user_id: " " })).toBe(false);
    expect(isOwnedByStudio("studio-a", null)).toBe(false);
    expect(isOwnedByStudio("studio-a", undefined)).toBe(false);
  });

  test("rechecks a changed owner rather than trusting earlier authorization", () => {
    const request: { user_id: string | null } = { user_id: "studio-a" };
    expect(isOwnedByStudio("studio-a", request)).toBe(true);
    request.user_id = "studio-b";
    expect(isOwnedByStudio("studio-a", request)).toBe(false);
    request.user_id = null;
    expect(isOwnedByStudio("studio-a", request)).toBe(false);
  });
});

describe("literal verified-email claims", () => {
  test("escapes percent, underscore and backslash without adding wildcards", () => {
    expect(escapeClientEmailPattern("alice_%@example.com")).toBe("alice\\_\\%@example.com");
    expect(escapeClientEmailPattern(String.raw`alice\_%@example.com`)).toBe(
      String.raw`alice\\\_\%@example.com`,
    );
    expect(escapeClientEmailPattern("Alice+Sport@Example.COM")).toBe("Alice+Sport@Example.COM");
  });

  test("allows exact case-insensitive email only, not wildcard neighbors", () => {
    expect(clientClaimEmailMatches("Alice_Sport@Example.COM", "alice_sport@example.com")).toBe(
      true,
    );
    expect(clientClaimEmailMatches("alice_sport@example.com", "alicexsport@example.com")).toBe(
      false,
    );
    expect(clientClaimEmailMatches("alice%@example.com", "alice.jones@example.com")).toBe(false);
    expect(clientClaimEmailMatches("alice%@example.com", "ALICE%@EXAMPLE.COM")).toBe(true);
    expect(clientClaimEmailMatches("*@example.com", "victim@example.com")).toBe(false);
    expect(clientClaimEmailMatches("*@example.com", "*@EXAMPLE.COM")).toBe(true);
  });

  test("never folds distinct mailbox spelling or treats missing emails as claims", () => {
    expect(clientClaimEmailMatches("alice+sport@example.com", "alice@example.com")).toBe(false);
    expect(clientClaimEmailMatches("alice.sport@example.com", "alicesport@example.com")).toBe(
      false,
    );
    expect(clientClaimEmailMatches("alice@example.com", " alice@example.com")).toBe(false);
    expect(
      clientClaimEmailMatches(String.raw`alice\sport@example.com`, "alicesport@example.com"),
    ).toBe(false);
    expect(clientClaimEmailMatches("alice@example.com", null)).toBe(false);
    expect(clientClaimEmailMatches("alice@example.com", undefined)).toBe(false);
    expect(clientClaimEmailMatches("", "")).toBe(false);
  });
});
