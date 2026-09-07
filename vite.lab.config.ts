import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { developmentLabPlugin } from "./src/server/development-lab";
import { nativeStudioPlugin } from "./src/server/native-studio-plugin";

// Deliberately separate from vite.config.ts: production never gets a local identity.
export default defineConfig({
  vite: { plugins: [developmentLabPlugin(import.meta.dirname), nativeStudioPlugin()] },
  tanstackStart: { server: { entry: "server" } },
});
