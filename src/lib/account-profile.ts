import { z } from "zod";
import { displayNameSchema } from "./account-preferences";

export const profileInputSchema = z
  .object({
    name: displayNameSchema,
    workspaceName: displayNameSchema,
  })
  .strict();
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Presentation metadata only. Never use these editable fields for authorization. */
export function readAccountProfile(metadata: Record<string, unknown> | undefined) {
  const workspace = displayNameSchema.safeParse(metadata?.["lenslabs_workspace_name"]);
  return {
    workspaceName: workspace.success ? workspace.data : "Personal workspace",
    setupComplete: metadata?.["lenslabs_setup_version"] === 1,
  };
}

export function profileMetadata(input: ProfileInput) {
  const value = profileInputSchema.parse(input);
  return {
    display_name: value.name,
    full_name: value.name,
    lenslabs_workspace_name: value.workspaceName,
    lenslabs_setup_version: 1,
  };
}
