import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Validate the generated deployment contract, without uploading or changing DNS.
const root = resolve(import.meta.dirname, "../.output/server");
const config = JSON.parse(readFileSync(resolve(root, "wrangler.json"), "utf8"));
if (!config.main || !existsSync(resolve(root, config.main)))
  throw new Error("Workers server entry is missing.");
if (config.assets?.binding !== "ASSETS" || !existsSync(resolve(root, config.assets.directory)))
  throw new Error("Workers static assets are missing.");
if (!config.compatibility_flags?.includes("nodejs_compat"))
  throw new Error("This server requires nodejs_compat.");
if (config.name !== "lenslab-web" || config.keep_vars !== true)
  throw new Error("Production Worker identity and runtime-variable preservation are required.");
if (!config.services?.some((item: { binding: string; service: string }) =>
  item.binding === "CANONICAL_V2" && item.service === "lenslab-canonical-v2-private"))
  throw new Error("Private V2 service binding is missing. This binding does not enable V2.");
if (config.routes?.length || config.route)
  throw new Error("Temporary deployment must not contain custom-domain routes.");
if (Object.keys(config.vars ?? {}).length)
  throw new Error("Use private runtime configuration, not generated inline variables.");
console.log("Workers server + static assets verified; no custom-domain routes. Not deployed.");
