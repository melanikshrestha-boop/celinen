import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { developmentLabPlugin } from "./src/server/development-lab";
import { nativeStudioPlugin } from "./src/server/native-studio-plugin";
import { nativeDevelopPlugin } from "./src/server/native-develop";
import { nativeReferencePlugin } from "./src/server/native-reference";
import { nativeCropPlugin } from "./src/server/native-crop";
import { nativeObjectRemovePlugin } from "./src/server/native-object-remove";
import { nativeReceiptPlugin } from "./src/server/native-receipt";
import { nativeGalleryPlugin } from "./src/server/native-gallery";
import { nativeSettingsPlugin } from "./src/server/native-settings";
import { socialPastePlugin } from "./src/server/social-paste-plugin";

// Deliberately separate from vite.config.ts: production never gets a local identity.
export default defineConfig({
  vite: {
    plugins: [
      developmentLabPlugin(import.meta.dirname),
      nativeStudioPlugin(),
      nativeDevelopPlugin(),
      nativeReferencePlugin(),
      nativeCropPlugin(),
      nativeObjectRemovePlugin(),
      nativeReceiptPlugin(),
      nativeGalleryPlugin(),
      nativeSettingsPlugin(),
      socialPastePlugin(),
    ],
  },
  tanstackStart: { server: { entry: "server" } },
});
