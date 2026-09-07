import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      ...[
        "@/integrations/supabase/client",
        "@/lib/account.functions",
        "@/lib/commerce/functions",
      ].map((find) => ({ find, replacement: resolve(import.meta.dirname, "fixture.ts") })),
      { find: "@", replacement: resolve(root, "src") },
    ],
  },
  server: { host: "127.0.0.1", port: 8084, strictPort: true, fs: { allow: [root] } },
});
