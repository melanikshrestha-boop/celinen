/** Loads the C++ cull engine wherever it is needed: inside the analysis worker
 * for per-frame measurement, and on the page for the shoot-level pass. One
 * compiled module per context; a browser that cannot run it keeps the existing
 * browser measurements instead.
 */
import { instantiateCullWasm, type CullEngine } from "./engine";

let pending: Promise<CullEngine | null> | null = null;

async function load(): Promise<CullEngine | null> {
  if (typeof WebAssembly === "undefined") return null;
  const url = new URL("./celinen-cull.wasm", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cull engine download failed (${response.status}).`);
  return instantiateCullWasm(await response.arrayBuffer());
}

/** Null when this browser cannot run the engine, or its download failed.
 * A failure is not cached, so a dropped connection does not disable culling
 * for the rest of the session.
 */
export function cullEngine(): Promise<CullEngine | null> {
  pending ??= load().catch(() => {
    pending = null;
    return null;
  });
  return pending;
}
