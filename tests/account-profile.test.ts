import { describe, expect, test } from "bun:test";
import {
  profileInputSchema,
  profileMetadata,
  readAccountProfile,
} from "../src/lib/account-profile";
import { persistProfileMetadata } from "../src/lib/account-profile.server";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = {
  owner,
  expectedOwner: owner,
  authUrl: "https://auth.example.test",
  publishableKey: "public-fixture",
  authorization: "Bearer fixture",
  metadata: profileMetadata({ name: "Vincent van Gogh", workspaceName: "Night games" }),
};
describe("account setup and presentation profile", () => {
  test("existing accounts are safe to introduce to setup without claiming a profile", () => {
    expect(readAccountProfile(undefined)).toEqual({
      workspaceName: "Personal workspace",
      setupComplete: false,
    });
    expect(
      readAccountProfile({
        name: "Somebody",
        lenslabs_setup_version: "1",
        lenslabs_workspace_name: { admin: true },
      }).setupComplete,
    ).toBe(false);
  });
  test("profile completion is typed and preserves names in any language", () => {
    const metadata = profileMetadata({ name: "  José 摄影  ", workspaceName: "東京 Studio" });
    expect(metadata.display_name).toBe("José 摄影");
    expect(readAccountProfile(metadata)).toEqual({
      workspaceName: "東京 Studio",
      setupComplete: true,
    });
  });
  test("rejects blank, control, overlong names and undeclared authorization fields", () => {
    for (const field of ["name", "workspaceName"])
      for (const value of ["", "  ", "a".repeat(81), "one\nTwo", "a\0b", {}, 4, null]) {
        expect(
          profileInputSchema.safeParse({ name: "Name", workspaceName: "Studio", [field]: value })
            .success,
        ).toBe(false);
      }
    expect(
      profileInputSchema.safeParse({ name: "Name", workspaceName: "Studio", role: "admin" })
        .success,
    ).toBe(false);
    expect(Object.keys(input.metadata)).toEqual([
      "display_name",
      "full_name",
      "lenslabs_workspace_name",
      "lenslabs_setup_version",
    ]);
    expect(
      profileInputSchema.safeParse({
        name: "Name",
        workspaceName: "Studio",
        workRole: "admin",
      }).success,
    ).toBe(false);
    expect(
      readAccountProfile(
        profileMetadata({
          name: "Name",
          workspaceName: "Studio",
          workRole: "college-football",
        }),
      ),
    ).toMatchObject({
      setupComplete: true,
      workRole: "college-football",
    });
  });
  test("account mismatch does not send a network request", async () => {
    let called = false;
    await expect(
      persistProfileMetadata({ ...input, expectedOwner: "another" }, (async () => {
        called = true;
        return new Response();
      }) as typeof fetch),
    ).rejects.toThrow("account changed");
    expect(called).toBe(false);
  });
  test("captured credentials and only the requested metadata are sent", async () => {
    await persistProfileMetadata(input, (async (url: unknown, options?: RequestInit) => {
      expect(String(url)).toBe("https://auth.example.test/auth/v1/user");
      expect(options?.method).toBe("PUT");
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer fixture");
      expect(new Headers(options?.headers).get("apikey")).toBe("public-fixture");
      expect(JSON.parse(options?.body as string)).toEqual({ data: input.metadata });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ id: owner });
    }) as typeof fetch);
  });
  test("rejects provider failures, malformed replies and mismatched owners", async () => {
    for (const response of [
      new Response("secret provider details", { status: 401 }),
      Response.json({ id: "other" }),
      Response.json({}),
      new Response("not json"),
    ]) {
      await expect(
        persistProfileMetadata(input, (async () => response) as typeof fetch),
      ).rejects.toThrow();
    }
    await expect(
      persistProfileMetadata(input, (async () => {
        throw new Error("network offline");
      }) as typeof fetch),
    ).rejects.toThrow("network offline");
  });
});
