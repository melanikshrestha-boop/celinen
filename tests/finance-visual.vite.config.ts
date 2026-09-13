import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";

// Storage-free presentation QA, never the authenticated app or a publishing target.
export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  appType: "mpa",
  envDir: false,
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "../src") } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "lucide-react"] },
  server: {
    host: "127.0.0.1",
    port: 8096,
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' ws://127.0.0.1:8096; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'",
    },
  },
});
