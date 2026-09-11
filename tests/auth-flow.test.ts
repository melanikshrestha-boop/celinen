import { describe, expect, test } from "bun:test";
import { authReturnUrl, isLocalAuthOrigin, parseAuthSearch } from "../src/lib/auth-flow";

describe("account entry", () => {
  test("defaults every new auth visit to account creation", () => {
    expect(parseAuthSearch({})).toEqual({ next: "/dashboard", mode: "signup" });
    expect(parseAuthSearch({ next: "/studio" })).toEqual({
      next: "/studio",
      mode: "signup",
    });
  });

  test("keeps returning photographers on explicit sign in", () => {
    expect(parseAuthSearch({ mode: "signin", next: "/workspace" })).toEqual({
      next: "/workspace",
      mode: "signin",
    });
    expect(parseAuthSearch({ mode: "signin", google: true })).toEqual({
      next: "/dashboard",
      mode: "signin",
      google: true,
    });
    expect(parseAuthSearch({ mode: "signin", google: "1" })).toEqual({
      next: "/dashboard",
      mode: "signin",
      google: true,
    });
  });

  test("keeps gallery acquisition scoped to the delivery workflow", () => {
    expect(parseAuthSearch({ source: "client-gallery", next: "https://evil.test" })).toEqual({
      next: "/deliver?workflow=1",
      mode: "signup",
      source: "client-gallery",
    });
  });
});

describe("Google OAuth handoff", () => {
  test("returns hosted OAuth to the exact safe workspace location", () => {
    const redirectTo = authReturnUrl(
      "http://localhost:8080",
      "/studio?project=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(new URL(redirectTo).searchParams.get("next")).toBe(
      "/studio?project=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(redirectTo).not.toContain("~oauth");
  });

  test("separates local previews from Lovable-hosted OAuth", () => {
    for (const origin of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"])
      expect(isLocalAuthOrigin(origin)).toBe(true);
    expect(isLocalAuthOrigin("https://lenslab.dev")).toBe(false);
    expect(isLocalAuthOrigin("not a url")).toBe(false);
  });

  test("preserves 40,000 safe deep-link permutations without generating the dead broker route", () => {
    for (let index = 0; index < 40_000; index++) {
      const next = `/studio?project=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa&frame=${index}#review`;
      const result = new URL(authReturnUrl("http://localhost:8080", next, index % 2 === 0));
      expect(result.origin).toBe("http://localhost:8080");
      expect(result.pathname).toBe("/auth");
      expect(result.searchParams.get("next")).toBe(next);
      expect(result.href).not.toContain("~oauth");
      if (index % 2 === 0) expect(result.searchParams.get("source")).toBe("client-gallery");
    }
  });
});
