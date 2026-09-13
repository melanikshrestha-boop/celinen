/* Isolated LAB QA only. Uses the fresh six-public-JPEG scene seed, not customer photos.
 * Set fotoShortlistQaShoot to that UUID and fotoShortlistQaPhase to prepare/readback.
 * Preparation sets test decisions once; readback never changes data. */
if (location.origin !== "http://127.0.0.1:8085" || globalThis.fotoIsolatedQaProfile !== true)
  throw new Error("Isolated LAB profile required.");
const shoot = globalThis.fotoShortlistQaShoot;
if (typeof shoot !== "string" || !/^[a-f0-9-]{36}$/.test(shoot)) throw new Error("QA shoot required.");
const seed = JSON.parse(sessionStorage.getItem(`foto:qa:scene-seed:${shoot}`) ?? "null");
if (!seed || seed.shoot !== shoot || seed.entries.length !== 6 ||
    seed.entries.some((entry, i) => entry.id !== `qa-scene:${shoot}:${i}`))
  throw new Error("Only the newly generated public fixture seed is allowed.");
const options = { scope: "device-local", libraryId: `shoot:${shoot}` };
const { createDevelopStore } = await import("/src/lib/develop/store.ts");
const { createShootRepository } = await import("/src/lib/develop/shoot-repository.ts");
const { createCullShootView } = await import("/src/lib/develop/cull-view.ts");
const { shortlistRequest, requestShortlist } = await import("/src/lib/studio/shortlist.ts");
const store = createDevelopStore(options);
const marker = `foto:qa:shortlist:${shoot}`;
if (globalThis.fotoShortlistQaPhase === "prepare") {
  if (sessionStorage.getItem(marker)) throw new Error("QA preparation already ran. Never reset tested decisions.");
  const library = await store.loadLibraryWithManifest();
  if (library.photos.length !== 6) throw new Error("Unexpected QA library size.");
  for (let i = 0; i < 6; i++) {
    const document = library.documents[seed.entries[i].id];
    await store.saveDocument({ ...document, metadata: { ...document.metadata,
      flag: i === 1 || i === 3 ? "pick" : i === 4 ? "reject" : null,
      colorLabel: i === 5 ? "red" : null,
    } }, document.revision);
  }
}
const repository = createShootRepository(options);
const projected = await createCullShootView(repository).read();
const originals = await store.loadLibraryWithManifest();
const hashes = [];
for (const photo of originals.photos) {
  const hash = "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", await photo.sourceBlob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const expected = seed.entries.find((entry) => entry.id === photo.id);
  if (!expected || hash !== expected.sourceHash || photo.sourceBlob.size !== expected.bytes)
    throw new Error("Original bytes changed.");
  if (originals.documents[photo.id].history.length !== 1) throw new Error("Unexpected native edit history change.");
  hashes.push({ id: photo.id, hash });
}
if (globalThis.fotoShortlistQaPhase === "prepare") {
  const expected = await requestShortlist(shortlistRequest(projected.shots, 3));
  if (expected.candidateIds.length !== 1) throw new Error("Public fixture must have one measured eligible suggestion.");
  sessionStorage.setItem(marker, JSON.stringify({ expected, hashes }));
}
const expected = JSON.parse(sessionStorage.getItem(marker) ?? "null");
store.close(); repository.close();
return {
  shoot, phase: globalThis.fotoShortlistQaPhase,
  shots: projected.shots.map(({ id, verdict, score, sharpness, brightness, flags, develop }) =>
    ({ id, verdict, score, sharpness, brightness, flags, label: develop?.label })),
  expected: expected?.expected,
  unchangedOriginals: hashes.length,
  orderedIds: originals.manifest.photoIds,
};
