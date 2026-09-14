import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Pages must receive the server worker, not just Vite's static assets.
const root = resolve(import.meta.dirname, "../dist");
const entries = ["_worker.js/index.js", "_worker.js/index.mjs", "_worker.js"];
const entry = entries.find((path) => {
  if (!existsSync(resolve(root, path))) return false;
  try {
    return readFileSync(resolve(root, path), "utf8").length > 0;
  } catch {
    return false;
  }
});
if (!entry) throw new Error("Pages server worker missing; do not deploy a static-only build.");
const routes = JSON.parse(readFileSync(resolve(root, "_routes.json"), "utf8"));
if (routes.version !== 1 || !routes.include?.includes("/*"))
  throw new Error("Pages worker must receive application and API routes.");
if (!existsSync(resolve(root, "assets"))) throw new Error("Pages browser assets missing.");
console.log(
  `Pages artifact verified: dist/${entry}, server routing, browser assets. Not deployed.`,
);
