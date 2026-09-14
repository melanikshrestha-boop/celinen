import { defineConfig as viteDefineConfig, loadEnv, mergeConfig, type UserConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
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
import { voiceSttPlugin } from "./src/server/voice-stt-plugin";

/** Local lab config — never used for production deploy. */
export default viteDefineConfig(async ({ command, mode }) => {
  const internalPlugins: UserConfig["plugins"] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    react(),
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
    voiceSttPlugin(),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    internalPlugins.push(nitro({ defaultPreset: "cloudflare-module" }));
  }

  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define: envDefine,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    plugins: internalPlugins,
    server: { host: "127.0.0.1", port: 8085, strictPort: true },
  };
});
