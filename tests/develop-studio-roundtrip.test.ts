import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import * as developStore from "../src/lib/develop/store";
import { createShootRepository } from "../src/lib/develop/shoot-repository";
import { createCullShootView } from "../src/lib/develop/cull-view";
import { asDevelopPreviewBlob } from "../src/lib/develop/decode-preview";
import type { HydratedStudioSession } from "../src/lib/studio/session";
import { developIdbDouble } from "./fixtures/develop-idb-double";

// Real projection, serializer/hydrator, adoption code and canonical store; only
// browser scheduling/URLs and IndexedDB are replaced. No customer data is read.
const editorSource = readFileSync(
  new URL("../src/components/develop/DevelopPage.tsx", import.meta.url),
  "utf8",
);
const sessionSource = readFileSync(
  new URL("../src/lib/studio/session.ts", import.meta.url),
  "utf8",
);
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing roundtrip boundary: ${start}`);
  return source.slice(from, to);
}
const serializer = between(
  sessionSource,
  "    const records: StoredShot[] = await Promise.all(",
  '    const transaction = database.transaction([SESSION_STORE, SHOT_STORE], "readwrite");',
);
const hydrator = between(
  sessionSource,
  "      shots = records.map((record): Shot => {",
  "    } catch (cause) {",
);
const adoption = between(
  editorSource,
  "              const receipt = await store.addPhotosWithDocuments(",
  "            }\n          } finally {",
);
function execute(code: string, context: Record<string, unknown>, result: string) {
  return new Function(
    ...Object.keys(context),
    transpiler.transformSync(`async function run() { ${code}\n${result} }`) + "\nreturn run();",
  )(...Object.values(context));
}
async function persistedSession(session: HydratedStudioSession): Promise<HydratedStudioSession> {
  const records = await execute(
    serializer,
    { shots: session.shots, asDevelopPreviewBlob },
    "return records;",
  );
  const shots = await execute(
    `let shots; const createdUrls = []; ${hydrator}`,
    { records, URL: { createObjectURL: () => "blob:reserved-synthetic-preview" } },
    "return shots;",
  );
  return { ...session, shots };
}
async function fixture() {
  const db = developIdbDouble();
  const repository = createShootRepository({
    scope: `roundtrip-qa-${crypto.randomUUID()}`,
    libraryId: "reserved-shoot",
    factory: db.factory,
  });
  const inputs = await Promise.all(
    ["a", "b", "c"].map((name) =>
      developStore.developPhotoFromFile(
        new File([`synthetic original ${name}`], `${name}.jpg`),
        new Blob([`synthetic preview ${name}`], { type: "image/jpeg" }),
      ),
    ),
  );
  const receipt = await repository.store.addPhotosWithDocuments(inputs);
  const first = receipt.documents[inputs[0]!.id]!;
  await repository.store.saveDocument({
    ...developStore.addSnapshot(
      developStore.pushHistory(
        first,
        { ...developStore.currentRecipe(first), exposure: 1.25 },
        "Preserved native edit",
      ),
      "Preserved native snapshot",
    ),
    metadata: { flag: "pick", rating: 4, colorLabel: "green" },
  });
  return {
    repository,
    async adoptDevelop(session: HydratedStudioSession) {
      return execute(
        adoption,
        {
          ...developStore,
          store: repository.store,
          session,
          snapshot: await repository.store.loadLibrary(),
        },
        "return snapshot;",
      );
    },
  };
}

function legacyShot(id: string): Shot {
  return {
    id,
    name: "authentic-legacy.ARW",
    file: new File([], "authentic-legacy.preview.jpg"),
    sourceAvailable: false,
    previewUrl: null,
    isRaw: true,
    width: 0,
    height: 0,
    sizeMb: 22,
    sharpness: 0,
    brightness: 0,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "",
    score: 0,
    flags: [],
    verdict: "reject",
    edits: { ...DEFAULT_EDITS, crop: "4:5" },
  };
}

describe("canonical Develop and persisted Cull roundtrips", () => {
  for (const destination of ["Develop", "Cull"] as const) {
    test(`native projection survives serialization and two ${destination} adoptions without studio-prefixed copies`, async () => {
      const f = await fixture();
      try {
        const before = await f.repository.read();
        const view = createCullShootView(f.repository);
        let session = await persistedSession(await view.read());
        expect(session.shots.every((shot) => shot.sourceAvailable === false)).toBe(true);
        expect(session.shots.map((shot) => shot.develop?.canonical)).toEqual(
          before.photos.map((photo) => ({ namespace: f.repository.namespace, photoId: photo.id })),
        );
        for (let turn = 0; turn < 2; turn++) {
          if (destination === "Develop") await f.adoptDevelop(session);
          else await createCullShootView(f.repository).read(session);
          const after = await f.repository.read();
          expect(after.manifest.photoIds).toEqual(before.manifest.photoIds);
          expect(after.photos.map((photo) => photo.id)).toEqual(
            before.photos.map((photo) => photo.id),
          );
          expect(after.documents).toEqual(before.documents);
          expect(after.photos.map((photo) => photo.sourceDigest)).toEqual(
            before.photos.map((photo) => photo.sourceDigest),
          );
          for (const [index, photo] of after.photos.entries()) {
            expect(photo.sourceAvailable).toBe(true);
            expect(await photo.sourceBlob!.text()).toBe(
              await before.photos[index]!.sourceBlob!.text(),
            );
          }
          session = await persistedSession(await createCullShootView(f.repository).read());
        }
      } finally {
        f.repository.close();
      }
    });
  }

  test("a genuine unmarked legacy hash-shaped ID remains a distinct missing-original record", async () => {
    const f = await fixture();
    try {
      const before = await f.repository.read();
      const legacy = legacyShot(before.photos[0]!.id);
      await f.adoptDevelop({
        shots: [legacy],
        selectedId: legacy.id,
        filter: "all",
        updatedAt: 1,
        roster: [],
        eventPeople: [],
      });
      const after = await f.repository.read();
      expect(after.manifest.photoIds).toEqual([...before.manifest.photoIds, `studio:${legacy.id}`]);
      expect(after.documents[before.photos[0]!.id]).toEqual(before.documents[before.photos[0]!.id]);
      const added = after.photos.at(-1)!;
      expect(added.sourceBlob).toBeNull();
      expect(added.sourceAvailable).toBe(false);
      expect(added.legacy!.shotId).toBe(legacy.id);
      expect(added.legacy!.unresolvedCrop).toBe("4:5");
      expect(after.documents[added.id]!.metadata.flag).toBe("reject");
    } finally {
      f.repository.close();
    }
  });

  test("virtual copies and canonical missing-original records retain their exact identities and saved documents", async () => {
    const f = await fixture();
    try {
      const initial = await f.repository.read();
      const originalId = initial.photos[0]!.id;
      await f.repository.store.createVirtualCopy(
        originalId,
        initial.documents[originalId]!.revision,
      );
      const missing = developStore.developPhotoFromShot(legacyShot("reserved-missing-original"));
      await f.repository.store.addPhotosWithDocuments([missing]);
      const before = await f.repository.read();
      const session = await persistedSession(await createCullShootView(f.repository).read());
      await f.adoptDevelop(session);
      await createCullShootView(f.repository).read(session);
      const after = await f.repository.read();
      expect(after.manifest.photoIds).toEqual(before.manifest.photoIds);
      expect(after.documents).toEqual(before.documents);
      expect(after.photos.map((photo) => photo.sourceDigest)).toEqual(
        before.photos.map((photo) => photo.sourceDigest),
      );
      const kept = after.photos.find((photo) => photo.id === missing.id)!;
      expect(kept.sourceBlob).toBeNull();
      expect(kept.sourceAvailable).toBe(false);
      expect(kept.legacy).toEqual(before.photos.at(-1)!.legacy);
    } finally {
      f.repository.close();
    }
  });

  test("foreign or mismatched references reject a mixed batch before adopting any legacy row", async () => {
    const f = await fixture();
    try {
      const before = await f.repository.read();
      const projected = await createCullShootView(f.repository).read();
      for (const fault of ["account", "shoot", "missing-photo", "shot-id", "digest"] as const) {
        const session = await persistedSession(projected);
        const shot = session.shots[0]!;
        shot.develop = {
          ...shot.develop!,
          canonical: { ...shot.develop!.canonical! },
        };
        if (fault === "account")
          shot.develop.canonical!.namespace = JSON.stringify(["another-account", "reserved-shoot"]);
        if (fault === "shoot") {
          const [scope] = JSON.parse(f.repository.namespace) as string[];
          shot.develop.canonical!.namespace = JSON.stringify([scope, "another-shoot"]);
        }
        if (fault === "missing-photo") shot.develop.canonical!.photoId = "reserved-missing-photo";
        if (fault === "shot-id") shot.id = "unrelated-legacy-row";
        if (fault === "digest") shot.sourceDigest = `sha256:${"0".repeat(64)}`;
        session.shots = [legacyShot(`new-legacy-${fault}`), shot];
        await expect(f.adoptDevelop(session)).rejects.toThrow("does not match its canonical photo");
        await expect(createCullShootView(f.repository).read(session)).rejects.toThrow(
          "does not match its canonical photo",
        );
        const after = await f.repository.read();
        expect(after.manifest.photoIds).toEqual(before.manifest.photoIds);
        expect(after.documents).toEqual(before.documents);
      }
    } finally {
      f.repository.close();
    }
  });

  test("missing or mismatched canonical documents and direct reference conversion fail closed", async () => {
    const f = await fixture();
    try {
      const before = await f.repository.read();
      const session = await persistedSession(await createCullShootView(f.repository).read());
      const shot = session.shots[0]!;
      expect(() => developStore.developPhotoFromShot(shot)).toThrow("canonical Cull reference");
      for (const fault of ["missing", "identity"] as const) {
        const documents = { ...before.documents };
        if (fault === "missing") delete documents[shot.id];
        else documents[shot.id] = { ...documents[shot.id]!, photoId: "another-photo" };
        expect(() =>
          developStore.developPhotosFromStudio(
            session.shots,
            { ...before, documents },
            f.repository.namespace,
          ),
        ).toThrow("does not match its canonical photo");
      }
      expect((await f.repository.read()).documents).toEqual(before.documents);
    } finally {
      f.repository.close();
    }
  });

  test("already stored studio-prefixed records are never deleted or merged automatically", async () => {
    const f = await fixture();
    try {
      const session = await persistedSession(await createCullShootView(f.repository).read());
      await f.repository.store.addPhotosWithDocuments(
        session.shots.map((shot) =>
          developStore.developPhotoFromShot({
            ...shot,
            develop: { ...shot.develop!, canonical: undefined },
          }),
        ),
      );
      const before = await f.repository.read();
      expect(before.photos).toHaveLength(6);
      await f.adoptDevelop(session);
      const after = await f.repository.read();
      expect(after.manifest.photoIds).toEqual(before.manifest.photoIds);
      expect(after.documents).toEqual(before.documents);
      expect(after.photos).toEqual(before.photos);
    } finally {
      f.repository.close();
    }
  });
});
