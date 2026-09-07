import { createClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";

// No real endpoint, credential, session, or session persistence. SDK types stay real.
export const supabase = createClient<Database>(
  "http://127.0.0.1:8085/__cloud_disabled",
  "lenslabs-local-development-not-a-credential",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "lenslabs.development-lab.no-session",
    },
    global: {
      fetch: async () => {
        throw new Error(
          "Cloud services are off in this local workspace. Use the signed-in website to publish or connect accounts.",
        );
      },
    },
  },
);
