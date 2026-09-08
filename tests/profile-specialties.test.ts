import { describe, expect, test } from "bun:test";
import {
  profileInputSchema,
  profileMetadata,
  readAccountProfile,
} from "../src/lib/account-profile";
import {
  PHOTOGRAPHY_SPECIALTIES,
  photographySpecialtyLabel,
} from "../src/lib/photography-specialties";

const original = { name: "Celine Nova", workspaceName: "Existing studio" };
describe("Private photography specialties", () => {
  test("every catalog entry round-trips without changing the workspace", () => {
    const ids = PHOTOGRAPHY_SPECIALTIES.flatMap<readonly [string, string]>(({ items }) => [
      ...items,
    ]);
    expect(new Set(ids.map(([id]) => id)).size).toBe(ids.length);
    for (const [id, label] of ids) {
      const metadata = profileMetadata({ ...original, specialties: [id] });
      expect(readAccountProfile(metadata).specialties).toEqual([id]);
      expect(metadata.lenslabs_workspace_name).toBe(original.workspaceName);
      expect(photographySpecialtyLabel(id)).toBe(label);
    }
  });
  test("old profiles and old update callers do not erase specialty metadata", () => {
    expect(profileInputSchema.parse(original)).toEqual(original);
    expect(readAccountProfile(undefined)).toEqual({
      workspaceName: "Personal workspace",
      setupComplete: false,
    });
    expect(profileMetadata(original)).not.toHaveProperty("lenslabs_specialties");
    expect(profileMetadata(original)).not.toHaveProperty("lenslabs_custom_specialty");
  });
  test("five selections and custom text persist; explicit empty values clear", () => {
    const value = {
      ...original,
      specialties: ["real-estate", "portrait", "drone", "wedding", "other"],
      customSpecialty: "  Dance photography  ",
    };
    expect(readAccountProfile(profileMetadata(value))).toMatchObject({
      specialties: value.specialties,
      customSpecialty: "Dance photography",
      workspaceName: original.workspaceName,
    });
    expect(
      readAccountProfile(profileMetadata({ ...original, specialties: [], customSpecialty: "" })),
    ).toMatchObject({ specialties: [], customSpecialty: "" });
  });
  test("rejects unknown, duplicate, oversized, and untrusted role fields", () => {
    for (const specialties of [
      ["admin"],
      ["wedding", "wedding"],
      ["real-estate", "portrait", "drone", "wedding", "other", "fine-art"],
    ])
      expect(profileInputSchema.safeParse({ ...original, specialties }).success).toBe(false);
    expect(
      profileInputSchema.safeParse({ ...original, customSpecialty: "x".repeat(81) }).success,
    ).toBe(false);
    expect(
      profileInputSchema.safeParse({ ...original, specialties: ["real-estate"], role: "admin" })
        .success,
    ).toBe(false);
    expect(
      readAccountProfile({
        lenslabs_specialties: ["admin"],
        lenslabs_custom_specialty: { bad: true },
      }),
    ).not.toHaveProperty("specialties");
  });
});
