/** Loads the cull intelligence engine wherever it is needed: the page for the
 * shoot-level passes (membership, burst roles), a worker for per-frame work.
 * One compiled module per context; a browser that cannot run it simply gets no
 * membership or role suggestions, and culling carries on.
 */
import { instantiateCullIntelWasm, type CullIntelEngine } from "./intel";

let pending: Promise<CullIntelEngine | null> | null = null;

async function load(): Promise<CullIntelEngine | null> {
  if (typeof WebAssembly === "undefined") return null;
  const response = await fetch(new URL("./celinen-cull-intel.wasm", import.meta.url));
  if (!response.ok) throw new Error(`Cull intelligence download failed (${response.status}).`);
  return instantiateCullIntelWasm(await response.arrayBuffer());
}

/** Null when this browser cannot run the engine, or the download failed. A
 * failure is not cached, so a dropped connection does not disable these passes
 * for the rest of the session. */
export function cullIntelEngine(): Promise<CullIntelEngine | null> {
  pending ??= load().catch(() => {
    pending = null;
    return null;
  });
  return pending;
}
