import { defineConfig as viteDefineConfig, loadEnv, mergeConfig, type UserConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
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
import { verifyProductionBuildEnvironment } from "./scripts/production-build-config";
import { readBuildInfo } from "./scripts/build-info";

type AppConfig = {
  vite?: UserConfig;
  tanstackStart?: Record<string, unknown>;
  nitro?: false | true | Record<string, unknown>;
  react?: Record<string, unknown>;
};

/**
 * Celinen app Vite config — TanStack Start + Nitro Cloudflare, no third-party editor wrapper.
 */
export default viteDefineConfig(async (env) => {
  const options: AppConfig = {
    vite: {
      optimizeDeps: { include: ["embla-carousel-react"] },
      plugins: [
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
      ],
    },
    tanstackStart: {
      server: { entry: "server" },
    },
  };

  const { command, mode } = env;
  const internalPlugins: UserConfig["plugins"] = [];

  if (mode === "development") {
    try {
      const { devtools } = await import("@tanstack/devtools-vite");
      internalPlugins.push(
        devtools({
          logging: false,
          eventBusConfig: { enabled: false },
          enhancedLogs: { enabled: false },
          consolePiping: { enabled: false },
          removeDevtoolsOnBuild: false,
          injectSource: { enabled: true },
        }),
      );
    } catch {
      /* optional */
    }
  }

  internalPlugins.push(tailwindcss());
  internalPlugins.push(tsConfigPaths({ projects: ["./tsconfig.json"] }));

  const tanstackStartOptions = mergeConfig(
    {
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    },
    options.tanstackStart ?? {},
  );
  internalPlugins.push(tanstackStart(tanstackStartOptions));

  if (options.nitro !== false && command === "build") {
    const { nitro } = await import("nitro/vite");
    const userNitroOpts = typeof options.nitro === "object" && options.nitro ? options.nitro : {};
    internalPlugins.push(
      nitro({
        defaultPreset: "cloudflare-module",
        cloudflare: {
          wrangler: {
            name: "lenslab-web", keep_vars: true, workers_dev: true,
            ai: { binding: "AI" },
            services: [{ binding: "CANONICAL_V2", service: "lenslab-canonical-v2-private" }],
          },
        },
        ...userNitroOpts,
      }),
    );
  }

  internalPlugins.push(react(options.react));

  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  if (command === "build" && process.env.LENSLAB_PRODUCTION_BUILD === "true")
    verifyProductionBuildEnvironment(loadedEnv);
  const envDefine: Record<string, string> = {};
  envDefine.__LENSLAB_BUILD_INFO__ = JSON.stringify(readBuildInfo(process.cwd()));
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  let config: UserConfig = {
    build: { rolldownOptions: { external: ["cloudflare:workers"] } },
    define: envDefine,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins: internalPlugins,
    server: { host: "::" },
  };

  if (options.vite) config = mergeConfig(config, options.vite);
  return config;
});
