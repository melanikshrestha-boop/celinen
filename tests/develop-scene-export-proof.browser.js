/* Guarded async browser-eval helper; no UI clicks or photo mutations.
 * Set fotoSceneProofPhase to "observe", "capture", "arm", "verify", or "restore".
 * Observe first, then Refresh set preview in the UI to capture new blob URLs.
 * Capture twice after selecting Prepared JPEG 0 then 1 through the actual UI.
 * Arm, click the real Download button, then verify. Interception calls the original
 * anchor click and restores itself after capturing one ZIP (or after 60 seconds).
 */
if (location.origin !== "http://127.0.0.1:8085" || globalThis.fotoIsolatedQaProfile !== true)
  throw new Error("Explicit isolated LAB profile required.");
const url = new URL(location.href);
const shoot = url.searchParams.get("shoot") ?? location.pathname.match(/\/shoots\/([^/]+)/)?.[1];
const seed = JSON.parse(sessionStorage.getItem(`foto:qa:scene-seed:${shoot}`) || "null");
if (!seed || seed.shoot !== shoot || !/^[0-9a-f-]{36}$/.test(shoot ?? ""))
  throw new Error("A saved fresh scene-QA seed is required.");
const expectedIds = seed.entries.filter((item) => item.keeper).map((item) => item.id);
if (expectedIds.length !== 2) throw new Error("Exactly two seeded keepers required.");
const state = (globalThis.fotoSceneExportProof ??= { shoot, captures: {}, checks: [] });
if (state.shoot !== shoot) throw new Error("Proof capture belongs to another QA shoot.");
const phase = globalThis.fotoSceneProofPhase ?? "capture";
const check = (name, valid) => {
  if (!valid) throw new Error(name);
  state.checks.push(name);
};
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
if (phase === "restore") {
  state.restore?.();
  state.restoreObserver?.();
  return { restored: true };
}
const { createDevelopStore } = await import("/src/lib/develop/store.ts");
const { readDevelopExportScope } = await import("/src/lib/develop/export-scope.ts");
const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
try {
  const scope = readDevelopExportScope(sessionStorage, store.namespace, location.href);
  check(
    "handoff exact ordered seeded keeper IDs",
    JSON.stringify(scope?.photoIds) === JSON.stringify(expectedIds),
  );
  const saved = await store.loadLibraryWithManifest();
  check(
    "manifest keeper order matches handoff",
    JSON.stringify(saved.manifest.photoIds.filter((id) => expectedIds.includes(id))) ===
      JSON.stringify(expectedIds),
  );
  check(
    "both seeded keeper decisions remain saved",
    expectedIds.every((id) => saved.documents[id]?.metadata.flag === "pick"),
  );
} finally {
  store.close();
}
if (phase === "observe") {
  state.restore?.();
  state.restoreObserver?.();
  const original = URL.createObjectURL;
  const blobs = new Map();
  state.blobs = blobs;
  state.captures = {};
  state.download = null;
  function observe(blob) {
    const href = Reflect.apply(original, this, [blob]);
    if (blob instanceof Blob) blobs.set(href, blob);
    return href;
  }
  let timer;
  state.restoreObserver = () => {
    if (URL.createObjectURL === observe) URL.createObjectURL = original;
    state.restore?.();
    clearTimeout(timer);
    blobs.clear();
  };
  URL.createObjectURL = observe;
  timer = setTimeout(state.restoreObserver, 300000);
  return {
    phase,
    instruction:
      "Refresh set preview, select Prepared JPEG 0 then 1 and capture each. Observer expires after five minutes.",
  };
}
if (phase === "capture") {
  const image = document.querySelector('img[alt^="Native export preview of "]');
  const figure = image?.closest("figure");
  const select = figure?.querySelector("select");
  if (!image || !image.complete || !image.naturalWidth || !select)
    throw new Error("Prepared native JPEG preview is not ready.");
  const index = Number(select.value);
  const option = select.selectedOptions[0];
  check("valid prepared JPEG index", index === 0 || index === 1);
  const filename = option.textContent.replace(/^\d+\.\s*/, "").trim();
  const currentUrl = image.currentSrc || image.src;
  if (!currentUrl.startsWith("blob:")) throw new Error("Expected an actual native proof blob URL.");
  const blob = state.blobs?.get(currentUrl);
  if (!(blob instanceof Blob))
    throw new Error("Observe first, then Refresh set preview; this URL was not observed.");
  const bytes = await blob.arrayBuffer();
  if ((image.currentSrc || image.src) !== currentUrl || Number(select.value) !== index)
    throw new Error("Proof selection changed during capture; capture again.");
  state.captures[index] = {
    id: expectedIds[index],
    filename,
    bytes: bytes.byteLength,
    sha256: await hash(bytes),
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  return { phase, capture: state.captures[index], captured: Object.keys(state.captures) };
}
if (phase === "arm") {
  if (!state.captures[0] || !state.captures[1])
    throw new Error("Capture both displayed native proofs first.");
  if (state.armed) throw new Error("Already armed; download or restore first.");
  const original = HTMLAnchorElement.prototype.click;
  let timer;
  const restore = () => {
    if (HTMLAnchorElement.prototype.click === intercept)
      HTMLAnchorElement.prototype.click = original;
    clearTimeout(timer);
    state.armed = false;
  };
  function intercept(...args) {
    if (this.download.toLowerCase().endsWith(".zip") && this.href.startsWith("blob:")) {
      const href = this.href;
      state.downloadName = this.download;
      const blob = state.blobs?.get(href);
      state.download =
        blob instanceof Blob
          ? blob.arrayBuffer()
          : Promise.reject(
              new Error("Download blob was not observed; observe and refresh proofs again."),
            );
      state.download.catch((error) => {
        state.error = String(error);
      });
      restore();
    }
    return Reflect.apply(original, this, args);
  }
  state.restore = restore;
  state.armed = true;
  HTMLAnchorElement.prototype.click = intercept;
  timer = setTimeout(() => {
    restore();
    state.restoreObserver?.();
  }, 60000);
  return {
    phase,
    armed: true,
    instruction: "Click actual Download ZIP, then set phase verify and rerun.",
  };
}
if (phase !== "verify" || !state.download)
  throw new Error("No captured ZIP; capture proofs, arm, then click Download.");
const buffer = await state.download;
const view = new DataView(buffer),
  bytes = new Uint8Array(buffer),
  decoder = new TextDecoder("utf-8", { fatal: true });
const { crc32 } = await import("/src/lib/zip.ts");
const entries = [];
let offset = 0;
while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
  if (offset + 30 > bytes.length) throw new Error("Truncated ZIP local header.");
  const flags = view.getUint16(offset + 6, true),
    method = view.getUint16(offset + 8, true);
  const size = view.getUint32(offset + 18, true),
    plain = view.getUint32(offset + 22, true);
  const nameLength = view.getUint16(offset + 26, true),
    extra = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extra,
    end = start + size;
  if (method !== 0 || flags !== 0x0800 || size !== plain || end > bytes.length)
    throw new Error("Expected bounded STORE-only UTF-8 ZIP entries.");
  const filename = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
  const data = bytes.slice(start, end);
  check(`ZIP CRC ${filename}`, crc32(data) === view.getUint32(offset + 14, true));
  entries.push({ filename, bytes: size, sha256: await hash(data) });
  offset = end;
}
check(
  "ZIP central directory follows exact entries",
  offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x02014b50,
);
check("exactly two ZIP entries", entries.length === 2);
for (let index = 0; index < entries.length; index++) {
  const proof = state.captures[index],
    entry = entries[index];
  check(`ordered filename ${index}`, entry.filename === proof.filename);
  check(
    `exact native proof bytes ${index}`,
    entry.sha256 === proof.sha256 && entry.bytes === proof.bytes,
  );
}
state.restore?.();
state.restoreObserver?.();
state.verified = {
  downloadName: state.downloadName,
  zipBytes: bytes.length,
  orderedIds: expectedIds,
  entries,
  checks: [...state.checks],
};
return state.verified;
