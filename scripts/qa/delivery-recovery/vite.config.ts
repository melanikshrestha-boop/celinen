import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": resolve(root, "src") } },
  server: {
    host: "127.0.0.1",
    port: 8086,
    strictPort: true,
    fs: { allow: [root] },
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' ws://127.0.0.1:8086; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
    },
  },
});
