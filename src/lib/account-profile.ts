import { z } from "zod";
import { displayNameSchema } from "./account-preferences";
import { AVATAR_LOCAL_LIMIT } from "./account-avatar";
import { isPhotographySpecialty, MAX_SPECIALTIES } from "./photography-specialties";
import {
  PHOTOGRAPHER_WORK_ROLES,
  type PhotographerWorkRole,
} from "./photographer-work-roles";

// Supabase includes user_metadata in access JWTs. Keep the inline thumbnail small
// enough that authenticated requests stay below common proxy/header limits.
export const AVATAR_METADATA_LIMIT = 4_096;

const specialtiesSchema = z
  .array(z.string().refine(isPhotographySpecialty, "Choose a listed specialty."))
  .max(MAX_SPECIALTIES, "Choose up to five specialties.")
  .refine((values) => new Set(values).size === values.length, "Choose each specialty once.");

const workRoleSchema = z.enum(
  PHOTOGRAPHER_WORK_ROLES.map((role) => role.id) as [
    PhotographerWorkRole,
    ...PhotographerWorkRole[],
  ],
);

export const profileInputSchema = z
  .object({
    name: displayNameSchema,
    workspaceName: displayNameSchema,
    specialties: specialtiesSchema.optional(),
    customSpecialty: z.string().trim().max(80).optional(),
    workRole: workRoleSchema.optional(),
    biography: z.string().trim().max(500).optional(),
    avatar: z
      .string()
      .max(AVATAR_LOCAL_LIMIT)
      .refine(
        (value) =>
          value === "" || /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value),
        "Choose a cropped JPEG profile image.",
      )
      .optional(),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Presentation metadata only. Never use these editable fields for authorization. */
export function readAccountProfile(metadata: Record<string, unknown> | undefined) {
  const workspace = displayNameSchema.safeParse(metadata?.["lenslabs_workspace_name"]);
  const specialties = specialtiesSchema.safeParse(metadata?.["lenslabs_specialties"]);
  const customSpecialty = profileInputSchema.shape.customSpecialty.safeParse(
    metadata?.["lenslabs_custom_specialty"],
  );
  const workRole = workRoleSchema.safeParse(metadata?.["lenslabs_work_role"]);
  return {
    workspaceName: workspace.success ? workspace.data : "Personal workspace",
    setupComplete: metadata?.["lenslabs_setup_version"] === 1,
    ...(specialties.success ? { specialties: specialties.data } : {}),
    ...(customSpecialty.success && customSpecialty.data !== undefined
      ? { customSpecialty: customSpecialty.data }
      : {}),
    ...(workRole.success ? { workRole: workRole.data } : {}),
    ...(typeof metadata?.["lenslabs_biography"] === "string"
      ? { biography: String(metadata["lenslabs_biography"]).slice(0, 500) }
      : {}),
    ...(profileInputSchema.shape.avatar.safeParse(metadata?.["lenslabs_avatar"]).success &&
    typeof metadata?.["lenslabs_avatar"] === "string"
      ? { avatar: metadata["lenslabs_avatar"] as string }
      : {}),
  };
}

export function profileMetadata(input: ProfileInput) {
  const value = profileInputSchema.parse(input);
  return {
    display_name: value.name,
    full_name: value.name,
    lenslabs_workspace_name: value.workspaceName,
    lenslabs_setup_version: 1,
    ...(value.specialties !== undefined ? { lenslabs_specialties: value.specialties } : {}),
    ...(value.customSpecialty !== undefined
      ? { lenslabs_custom_specialty: value.customSpecialty }
      : {}),
    ...(value.workRole !== undefined ? { lenslabs_work_role: value.workRole } : {}),
    ...(value.biography !== undefined ? { lenslabs_biography: value.biography } : {}),
    ...(value.avatar !== undefined
      ? {
          lenslabs_avatar:
            value.avatar === "" || value.avatar.length <= AVATAR_METADATA_LIMIT
              ? value.avatar
              : "",
        }
      : {}),
  };
}
