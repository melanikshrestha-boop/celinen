import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { verifyProductionBuildEnvironment, PRODUCTION_SUPABASE_URL } from "../scripts/production-build-config";

const valid = {
  VITE_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
  VITE_POSTHOG_ENABLED: "true",
  VITE_POSTHOG_HOST: "https://us.i.posthog.com",
  VITE_POSTHOG_KEY: "test-capture-key",
};

describe("production infrastructure contract", () => {
  test("requires yzyvoo and main's complete consent-gated analytics configuration", () => {
    expect(() => verifyProductionBuildEnvironment(valid)).not.toThrow();
    for (const name of Object.keys(valid))
      expect(() => verifyProductionBuildEnvironment({ ...valid, [name]: "" })).toThrow();
    expect(() => verifyProductionBuildEnvironment({ ...valid, VITE_SUPABASE_URL: "https://old.supabase.co" })).toThrow();
    expect(() => verifyProductionBuildEnvironment({ ...valid, VITE_POSTHOG_ENABLED: "false" })).toThrow();
  });
  test("fails closed on frontend-exposed server secrets without echoing values", () => {
    for (const key of ["VITE_STRIPE_SECRET", "VITE_SUPABASE_SERVICE_ROLE_KEY", "VITE_CLOUDFLARE_AI_API_TOKEN"]) {
      let message = "";
      try { verifyProductionBuildEnvironment({ ...valid, [key]: "never-print-this" }); }
      catch (error) { message = (error as Error).message; }
      expect(message).toContain("Server credentials");
      expect(message).not.toContain("never-print-this");
    }
  });
  test("hosting and Stripe transport have no Lovable runtime dependency", () => {
    const root = new URL("../", import.meta.url);
    for (const file of ["package.json", "vite.config.ts", "vite.lab.config.ts", "src/lib/stripe.server.ts", "src/lib/cloudflare-ai.server.ts", "src/routes/api/chat.ts", "src/integrations/supabase/previewAuthStorage.ts"]) {
      expect(readFileSync(new URL(file, root), "utf8")).not.toMatch(/@lovable\.dev|(?:ai|connector)-gateway\.lovable\.dev|LOVABLE_API_KEY/);
    }
  });
});
