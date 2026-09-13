/* Async browser-eval body. Only run in the explicitly isolated LAB Chromium
 * profile. Seeds six QA instances of three public JPEGs in a new UUID shoot.
 * Original bytes are never changed; repeated fixture instances have distinct QA
 * IDs. Actual C++ receipts are required, not fabricated detector measurements.
 * No customer namespace reads, no database deletion and no legacy recipes.
 */
if (location.origin !== "http://127.0.0.1:8085" || globalThis.fotoIsolatedQaProfile !== true)
  throw new Error("Explicit isolated LAB browser confirmation is required.");
const { createDevelopStore, developPhotoFromFile } = await import("/src/lib/develop/store.ts");
const { prepareDevelopImportPreview } = await import("/src/lib/develop/import-session.ts");
const { createShootRepository } = await import("/src/lib/develop/shoot-repository.ts");
const { createCullShootView } = await import("/src/lib/develop/cull-view.ts");
const shoot = crypto.randomUUID();
const options = { scope: "device-local", libraryId: `shoot:${shoot}` };
const store = createDevelopStore(options);
if ((await store.loadLibraryWithManifest()).photos.length)
  throw new Error("Never overwrite a shoot.");
const names = [
  "basketball-action-usaf-pd.jpg",
  "basketball-hangar-usnavy-pd.jpg",
  "volleyball-portrait-cc0.jpg",
];
const folders = ["warmup", "court", "portraits"];
const digest = async (blob) =>
  "sha256:" +
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const originals = [];
for (const name of names) {
  const response = await fetch(`/tests/fixtures/photos/${name}`);
  if (!response.ok) throw new Error(`Public fixture missing: ${name}`);
  const blob = await response.blob();
  originals.push({ name, blob, hash: await digest(blob) });
}
const photos = [];
const expected = [];
for (let index = 0; index < 6; index++) {
  const source = originals[Math.floor(index / 2)];
  const relativePath = `${folders[Math.floor(index / 2)]}/${index + 1}-${source.name}`;
  const file = new File([source.blob], source.name, { type: "image/jpeg", lastModified: 0 });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  const input = await developPhotoFromFile(file);
  input.id = `qa-scene:${shoot}:${index}`;
  input.name = `${index + 1} · ${source.name}`;
  // Path-only compatibility metadata: no edits, crop, or imported treatment.
  // Current Cull projection reads relativePath from this immutable archive.
  input.legacy = {
    version: 1,
    source: "studio",
    shotId: input.id,
    metadata: { id: input.id, relativePath },
  };
  const prepared = await prepareDevelopImportPreview(file, input, new AbortController().signal, {
    namespace: store.namespace,
  });
  if (prepared.analysis?.engine.name !== "native-cpp" || prepared.sourceDigest !== source.hash)
    throw new Error("A real native analysis receipt and unchanged source are required.");
  photos.push(prepared);
  expected.push({
    id: input.id,
    relativePath,
    sourceHash: source.hash,
    bytes: file.size,
    keeper: index === 1 || index === 3,
  });
}
const committed = await store.addPhotosWithDocuments(photos);
for (const item of expected) {
  const document = committed.documents[item.id];
  await store.saveDocument(
    {
      ...document,
      metadata: {
        ...document.metadata,
        flag: item.keeper ? "pick" : null,
        colorLabel: item.keeper ? null : "red",
      },
    },
    document.revision,
  );
}
const manifest = await store.readManifest();
await store.saveManifest(
  { photoIds: expected.map((item) => item.id), selectedId: expected[0].id, filter: "all" },
  manifest.revision,
);
const readback = await store.loadLibraryWithManifest();
for (const photo of readback.photos) {
  const item = expected.find((candidate) => candidate.id === photo.id);
  if (
    !item ||
    (await digest(photo.sourceBlob)) !== item.sourceHash ||
    photo.sourceBlob.size !== item.bytes
  )
    throw new Error("Original-byte readback failed.");
  const document = readback.documents[photo.id];
  if (
    document.history.length !== 1 ||
    document.history[0].label !== "Original" ||
    document.cursor !== 0
  )
    throw new Error("Seed must retain neutral native Original history only.");
}
const repository = createShootRepository(options);
const projected = await createCullShootView(repository).read();
if (
  projected.shots.length !== 6 ||
  projected.shots.filter((shot) => shot.verdict === "keep").length !== 2 ||
  projected.nativeTreatmentIds.size !== 6 ||
  projected.shots.some((shot, index) => shot.relativePath !== expected[index].relativePath)
)
  throw new Error("Seed Cull projection did not preserve IDs, paths, picks and native authority.");
store.close();
const result = {
  shoot,
  href: `/studio?shoot=${shoot}`,
  entries: expected,
  note: "Six QA fixture instances, three folder groups, two explicit keepers and four red undecided. Native measurements are real; folder labels and picks are seeded test data, not subject/location accuracy evidence.",
};
sessionStorage.setItem(`foto:qa:scene-seed:${shoot}`, JSON.stringify(result));
return result;
