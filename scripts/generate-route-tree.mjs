// Regenerates src/routeTree.gen.ts the way the Vite plugin does at build time,
// so a new file route (src/routes/**) typechecks and tests without a full build.
// Usage: node scripts/generate-route-tree.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";

const root = process.cwd();
const config = getConfig(
  {
    routesDirectory: "./src/routes",
    generatedRouteTree: "./src/routeTree.gen.ts",
    target: "react",
  },
  root,
);
await new Generator({ config, root }).run();

// The Start Vite plugin appends this module augmentation; the plain generator does not.
const START_REGISTER = `
import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}
`;
const file = path.isAbsolute(config.generatedRouteTree)
  ? config.generatedRouteTree
  : path.join(root, config.generatedRouteTree);
const text = await readFile(file, "utf8");
if (!text.includes("declare module '@tanstack/react-start'"))
  await writeFile(file, text + START_REGISTER);
console.log("src/routeTree.gen.ts regenerated");
