import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { displayNameSchema } from "./account-preferences";

/** Update metadata with a captured bearer, never with SDK updateUser's session rewrite. */
export const saveAccountName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ expectedOwner: z.string().uuid(), name: displayNameSchema }).strict())
  .handler(async ({ data, context }) => {
    if (context.userId !== data.expectedOwner)
      throw new Error("Your account changed. Reopen settings before saving.");
    const response = await fetch(new URL("/auth/v1/user", process.env["SUPABASE_URL"]!), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env["SUPABASE_PUBLISHABLE_KEY"]!,
        Authorization: getRequest().headers.get("authorization")!,
      },
      body: JSON.stringify({ data: { display_name: data.name, full_name: data.name } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error("Your profile could not be saved. Check your sign-in and try again.");
    const user = (await response.json()) as { id?: string };
    if (user.id !== context.userId)
      throw new Error("The profile response did not match your account.");
    return { name: data.name };
  });
