// Only run in browse's isolated QA profile. Public fixtures, never a customer shoot.
if (location.origin !== "http://127.0.0.1:8085") throw new Error("Local QA origin required");
const { createDevelopStore, developPhotoFromShot } = await import("/src/lib/develop/store.ts");
const { DEFAULT_EDITS } = await import("/src/lib/imaging.ts");
const shoot = crypto.randomUUID();
const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
const before = await store.loadLibraryWithManifest();
if (before.photos.length) throw new Error("Never overwrite a shoot");
const names = [
  "basketball-action-usaf-pd.jpg",
  "basketball-hangar-usnavy-pd.jpg",
  "volleyball-portrait-cc0.jpg",
  "basketball-action-usaf-pd.jpg",
];
const states = ["undecided", "keep", "undecided", "reject"];
const photos = [];
for (let i = 0; i < 4; i++) {
  const response = await fetch(`/tests/fixtures/photos/${names[i]}`);
  if (!response.ok) throw new Error("Public fixture missing");
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const shot = {
    id: `qa-dot-${i}`,
    name: `QA ${i + 1} ${names[i]}`,
    file: new File([blob], names[i], { type: "image/jpeg" }),
    previewBlob: blob,
    previewUrl: null,
    sourceAvailable: true,
    isRaw: false,
    width: bitmap.width,
    height: bitmap.height,
    sizeMb: blob.size / 1048576,
    sharpness: 200,
    brightness: 110,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "1".repeat(64),
    score: 90,
    flags: [],
    verdict: states[i],
    edits: { ...DEFAULT_EDITS },
    develop: { origin: "lens os", at: 0, ...(states[i] === "undecided" ? { label: "Red" } : {}) },
  };
  bitmap.close();
  photos.push(developPhotoFromShot(shot));
}
await store.addPhotosWithDocuments(photos);
const manifest = await store.readManifest();
await store.saveManifest(
  { photoIds: photos.map((p) => p.id), selectedId: photos[1].id, filter: "all" },
  manifest.revision,
);
store.close();
sessionStorage.setItem("celinen:qa:cull-dots", shoot);
return {
  shoot,
  href: `/studio?shoot=${shoot}`,
  note: "Four public test fixtures; deterministic UI review metadata, not detector or speed benchmark",
};
