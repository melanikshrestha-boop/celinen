import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * 8085 unless LENSLAB_LAB_PORT names another loopback port, so a second checkout
 * (a worktree) can run its own lab without stopping the one already on 8085.
 * Every origin check below is derived from this, so an alternate port is still
 * pinned to one exact host — it does not widen what the lab accepts.
 */
function configuredLabPort(): number {
  const raw = Number(process.env["LENSLAB_LAB_PORT"] ?? "");
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : 8085;
}
export const LAB_PORT = configuredLabPort();
export const LAB_HOST = `127.0.0.1:${LAB_PORT}`;
export const LAB_ORIGIN = `http://${LAB_HOST}`;

export function assertDevelopmentLab(command: string, mode: string) {
  if (command !== "serve" || mode !== "lab")
    throw new Error(
      "The no-sign-in lab is local development only. Use the normal config to build.",
    );
}

export function labRequestAllowed(request: {
  address?: string | undefined;
  host?: string | undefined;
  origin?: string | undefined;
  fetchSite?: string | undefined;
}) {
  return (
    ["127.0.0.1", "::ffff:127.0.0.1"].includes(request.address ?? "") &&
    request.host === LAB_HOST &&
    (!request.origin || request.origin === LAB_ORIGIN) &&
    (!request.fetchSite || ["same-origin", "none"].includes(request.fetchSite))
  );
}

/** Only installed by vite.lab.config.ts, never by the production configuration. */
export function developmentLabPlugin(root: string): Plugin {
  const replacements = new Map([
    [resolve(root, "src/components/account/AccountProvider.tsx"), "account.tsx"],
    [resolve(root, "src/integrations/supabase/client.ts"), "cloud.ts"],
    [resolve(root, "src/lib/app-mode.ts"), "mode.ts"],
  ]);
  return {
    name: "lenslabs-loopback-development-lab",
    enforce: "pre",
    config(_config, environment) {
      assertDevelopmentLab(environment.command, environment.mode);
      return {
        server: { host: "127.0.0.1", port: LAB_PORT, strictPort: true, cors: false },
        define: { "import.meta.env.VITE_GOOGLE_GMAIL_CLIENT_ID": JSON.stringify("") },
      };
    },
    transform(_code, id) {
      const replacement = replacements.get(id.split("?")[0]!);
      if (replacement)
        return {
          code: `export * from ${JSON.stringify(resolve(root, "src/dev", replacement))};`,
          map: null,
        };
      return null;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          !labRequestAllowed({
            address: request.socket.remoteAddress,
            host: request.headers.host,
            origin: request.headers.origin,
            fetchSite: request.headers["sec-fetch-site"] as string | undefined,
          })
        ) {
          response.writeHead(403).end("This development workspace is only available on this Mac.");
          return;
        }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Robots-Tag", "noindex, nofollow");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader(
          "Content-Security-Policy",
          [
            `connect-src 'self' ws://127.0.0.1:${LAB_PORT}`,
            "form-action 'self'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
          ].join("; "),
        );
        const path = new URL(request.url ?? "/", LAB_ORIGIN).pathname;
        if (path === "/api/places") {
          const q = new URL(request.url ?? "/", LAB_ORIGIN).searchParams.get("q") ?? "";
          void import("../lib/maps-places")
            .then(({ geocodePlaces }) => geocodePlaces(q, process.env.GOOGLE_MAPS_API_KEY || ""))
            .then((hits) => {
              response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ hits }));
            })
            .catch(() => {
              response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ hits: [] }));
            });
          return;
        }
        if (
          path.startsWith("/_serverFn/") ||
          path.startsWith("/__cloud_disabled") ||
          path.startsWith("/~oauth/") ||
          path.startsWith("/api/") ||
          request.headers["x-tsr-serverfn"] === "true"
        ) {
          response.writeHead(403, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              error:
                "Cloud services are off in this local development workspace. Use the signed-in website to publish or connect accounts.",
            }),
          );
          return;
        }
        next();
      });
    },
  };
}
