import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { developmentLabPlugin } from "./src/server/development-lab";
import { nativeStudioPlugin } from "./src/server/native-studio-plugin";
import { nativeDevelopPlugin } from "./src/server/native-develop";
import { nativeReferencePlugin } from "./src/server/native-reference";
import { nativeCropPlugin } from "./src/server/native-crop";

// Deliberately separate from vite.config.ts: production never gets a local identity.
export default defineConfig({
  vite: {
    plugins: [
      developmentLabPlugin(import.meta.dirname),
      nativeStudioPlugin(),
      nativeDevelopPlugin(),
      nativeReferencePlugin(),
      nativeCropPlugin(),
    ],
  },
  tanstackStart: { server: { entry: "server" } },
});
