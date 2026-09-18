import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
/** Isolated harness: the real composer, account card and C++ wasm framing,
 * with server functions and storage replaced by labelled fixtures. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      ...[
        "@/lib/business/instagram.functions",
        "@/lib/business/publishing.functions",
        "@/integrations/supabase/client",
      ].map((find) => ({ find, replacement: resolve(import.meta.dirname, "fixture.ts") })),
      { find: "@", replacement: resolve(root, "src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 8094,
    strictPort: true,
    fs: { allow: [root] },
    headers: {
      // Same wasm allowance as production: compile only, no script eval.
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' ws://127.0.0.1:8094; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
    },
  },
});
