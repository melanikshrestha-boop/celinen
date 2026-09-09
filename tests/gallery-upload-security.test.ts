/** Real handlers in isolated subprocesses: no credentials, network, browser, or customer data. */
import { describe, expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cases = [
  "reject foreign and noncanonical registration paths before storage access",
  "require a verified gallery owner for registration and photographer reads",
  "require exact nonempty stored objects before registering any rows",
  "preserve valid generated paths, long filenames, order, and metadata",
  "public signing quarantines poisoned legacy rows without deleting them",
  "photographer signing quarantines poisoned legacy rows without deleting them",
  "all-invalid legacy galleries never call a signer",
  "partial or failed signing never substitutes another photo URL",
  "public availability and passcode gates run before signing",
  "bound metadata verification and stop admission after a failed batch",
  "gallery deletion removes only exact owned-gallery originals",
  "gallery deletion stops on storage or photo-query failure",
  "gallery deletion requires verified ownership before reading or removing photos",
] as const;

if (!process.argv.includes("--gallery-security-fixture")) {
  describe("gallery upload and signed-download ownership boundary", () => {
    for (const [index, name] of cases.entries()) {
      test(name, () => {
        const result = Bun.spawnSync(
          [
            process.execPath,
            fileURLToPath(import.meta.url),
            "--gallery-security-fixture",
            String(index),
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
        expect(new TextDecoder().decode(result.stdout)).toContain("GALLERY_SECURITY_OK");
      });
    }
  });
} else {
  await runFixture(Number(process.argv.at(-1)));
}

async function runFixture(scenario: number) {
  globalThis.fetch = (() => {
    throw new Error("Unexpected network access in gallery security fixture");
  }) as typeof fetch;
  const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const galleryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const otherGallery = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const generated = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const path = `${owner}/${galleryId}/${generated}-original.jpg`;
  const secondPath = `${owner}/${galleryId}/${generated}-${"x".repeat(180)}.jpg`;
  const foreignPath = `${other}/${galleryId}/${generated}-private.jpg`;
  type Row = Record<string, unknown>;
  let gallery: Row;
  let photos: Row[];
  let info: Map<string, unknown>;
  let infoCalls: string[];
  let activeInfo: number;
  let maxActiveInfo: number;
  let signCalls: string[][];
  let removeCalls: string[][];
  let removeMode: "normal" | "error" | "throw";
  let photoReadError: boolean;
  let writes: { table: string; operation: string; value?: unknown }[];
  let signMode: "normal" | "reverse" | "partial" | "error" | "throw";
  const freshPhoto = (storage_path: string, id = storage_path): Row => ({
    id,
    user_id: owner,
    gallery_id: galleryId,
    storage_path,
    filename: storage_path.split("/").at(-1),
    width: 4000,
    height: 3000,
    sort_order: 0,
  });
  const goodInfo = (name: string) => ({ name, bucketId: "deliveries", size: 1024 });
  const reset = () => {
    gallery = {
      id: galleryId,
      user_id: owner,
      slug: "synthetic-gallery",
      status: "live",
      title: "Synthetic",
      expires_at: null,
      passcode: null,
      view_count: 0,
    };
    photos = [freshPhoto(path)];
    info = new Map([
      [path, goodInfo(path)],
      [secondPath, goodInfo(secondPath)],
    ]);
    infoCalls = [];
    activeInfo = 0;
    maxActiveInfo = 0;
    signCalls = [];
    removeCalls = [];
    removeMode = "normal";
    photoReadError = false;
    writes = [];
    signMode = "normal";
  };
  reset();
  const database = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let operation = "read";
      let value: unknown;
      let count = false;
      let columns = "*";
      const result = () => {
        if (operation !== "read") {
          writes.push({ table, operation, value });
          return { data: null, error: null };
        }
        if (table === "gallery_photos" && photoReadError) {
          return { data: null, error: { message: "Synthetic photo query failure" } };
        }
        const records =
          table === "galleries" ? [gallery] : table === "gallery_photos" ? photos : [];
        const filtered = records.filter((row) =>
          filters.every(([key, expected]) => row[key] === expected),
        );
        const projected = filtered.map((row) =>
          columns === "*"
            ? { ...row }
            : Object.fromEntries(columns.split(",").map((key) => [key.trim(), row[key.trim()]])),
        );
        return { data: projected, count: count ? projected.length : null, error: null };
      };
      const query = {
        select(selection = "*", options?: { count?: string }) {
          columns = selection;
          count = !!options?.count;
          return query;
        },
        eq(key: string, expected: unknown) {
          filters.push([key, expected]);
          return query;
        },
        order() {
          return query;
        },
        insert(rows: unknown) {
          operation = "insert";
          value = rows;
          return query;
        },
        update(row: unknown) {
          operation = "update";
          value = row;
          return query;
        },
        delete() {
          operation = "delete";
          return query;
        },
        async maybeSingle() {
          const reply = result();
          return { ...reply, data: reply.data?.[0] ?? null };
        },
        then(resolve: (reply: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "deliveries");
        return {
          async remove(paths: string[]) {
            removeCalls.push(paths.slice());
            if (removeMode === "throw") throw new Error("Synthetic removal failure");
            return removeMode === "error"
              ? { data: null, error: { message: "Synthetic removal failure" } }
              : { data: paths.map((name) => ({ name })), error: null };
          },
          async info(name: string) {
            infoCalls.push(name);
            activeInfo++;
            maxActiveInfo = Math.max(maxActiveInfo, activeInfo);
            await Promise.resolve();
            activeInfo--;
            const value = info.get(name);
            if (value instanceof Error) throw value;
            return value === undefined
              ? { data: null, error: { message: "Missing" } }
              : { data: value, error: null };
          },
          async createSignedUrls(paths: string[]) {
            signCalls.push(paths.slice());
            if (signMode === "throw") throw new Error("Synthetic signer unavailable");
            if (signMode === "error")
              return { data: null, error: { message: "Synthetic signer unavailable" } };
            const signed = paths.map((name, index) => ({
              path: name,
              signedUrl: `https://signed.example.invalid/${name}`,
              error: signMode === "partial" && index === 0 ? "Object not found" : null,
            }));
            return { data: signMode === "reverse" ? signed.reverse() : signed, error: null };
          },
        };
      },
    },
  };
  const auth = Symbol("required-auth");
  mock.module("@tanstack/react-start", () => ({
    createServerFn: () => {
      let validate: ((input: unknown) => unknown) | undefined;
      let authenticated = false;
      const builder = {
        middleware(middleware: unknown[]) {
          assert.deepEqual(middleware, [auth]);
          authenticated = true;
          return builder;
        },
        inputValidator(validator: (input: unknown) => unknown) {
          validate = validator;
          return builder;
        },
        handler(handler: (input: unknown) => unknown) {
          return (input: { data: unknown; context?: unknown }) => {
            if (authenticated)
              assert.ok(input.context, "Authenticated handler requires verified context");
            return handler({ ...input, data: validate ? validate(input.data) : input.data });
          };
        },
      };
      return builder;
    },
  }));
  mock.module("../src/integrations/supabase/auth-middleware", () => ({
    requireSupabaseAuth: auth,
  }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: database }));
  mock.module("../src/lib/gallery-visitor.server", () => ({
    mintVisitorToken: () => "synthetic-visitor-token",
    verifyVisitorToken: (_id: string, token?: string) => (token ? "synthetic-visitor" : null),
  }));
  const functions = await import("../src/lib/delivery.functions");
  type Reply = { error?: string; added?: number; photos?: (Row & { url: string | null })[] };
  type Handler = (input: { data: unknown; context?: unknown }) => Promise<Reply>;
  const add = (files: Row[]) =>
    (functions.addGalleryPhotos as unknown as Handler)({
      data: { gallery_id: galleryId, files },
      context: { userId: owner, supabase: database },
    });
  const open = () =>
    (functions.openGallery as unknown as Handler)({ data: { slug: "synthetic-gallery" } });
  const get = () =>
    (functions.getGallery as unknown as Handler)({
      data: { id: galleryId },
      context: { userId: owner, supabase: database },
    });
  const remove = () =>
    (functions.deleteGallery as unknown as Handler)({
      data: { id: galleryId },
      context: { userId: owner, supabase: database },
    });
  const noPhotoWrites = () =>
    assert.deepEqual(
      writes.filter((write) => write.table === "gallery_photos"),
      [],
    );
  const invalidPaths = [
    foreignPath,
    `${owner}/${otherGallery}/${generated}-original.jpg`,
    `${owner}/${galleryId}/plain.jpg`,
    `${owner}/${galleryId}/${generated}-../other.jpg`,
    `${owner}/${galleryId}/${generated}-%2e%2e%2fprivate.jpg`,
    `${owner}/${galleryId}/${generated}-back\\slash.jpg`,
    `${owner}//${galleryId}/${generated}-original.jpg`,
    `/${path}`,
    `${path}/`,
    `${path}\n`,
    `https://example.invalid/${path}`,
  ];
  if (scenario === 0) {
    for (const storage_path of invalidPaths) {
      reset();
      const reply = await add([{ storage_path, filename: "original.jpg" }]);
      assert.ok(reply.error, `Rejected before any writes: ${JSON.stringify(storage_path)}`);
      assert.deepEqual(infoCalls, []);
      noPhotoWrites();
      assert.deepEqual(writes, []);
    }
  } else if (scenario === 1) {
    gallery.user_id = other;
    assert.ok((await add([{ storage_path: path, filename: "original.jpg" }])).error);
    assert.ok((await get()).error);
    assert.deepEqual(infoCalls, []);
    assert.deepEqual(signCalls, []);
    assert.deepEqual(writes, []);
  } else if (scenario === 2) {
    for (const invalid of [
      undefined,
      null,
      { ...goodInfo(path), size: 0 },
      { ...goodInfo(path), size: -1 },
      { ...goodInfo(path), size: NaN },
      { ...goodInfo(path), size: "10" },
      { ...goodInfo(path), size: Number.MAX_SAFE_INTEGER + 1 },
      { ...goodInfo(path), name: foreignPath },
      { ...goodInfo(path), bucketId: "other" },
      new Error("Synthetic info failure"),
    ]) {
      reset();
      info.set(path, invalid);
      assert.ok(
        (
          await add([
            { storage_path: secondPath, filename: "valid.jpg" },
            { storage_path: path, filename: "unverified.jpg" },
          ])
        ).error,
      );
      noPhotoWrites();
      assert.deepEqual(writes, []);
    }
  } else if (scenario === 3) {
    const files = [
      { storage_path: path, filename: "original æ.jpg", width: 4000, height: 3000 },
      { storage_path: secondPath, filename: `${"x".repeat(180)}.jpg` },
    ];
    assert.equal((await add(files)).added, 2);
    assert.deepEqual(infoCalls.slice().sort(), [path, secondPath].sort());
    assert.deepEqual(
      writes.filter((write) => write.table === "gallery_photos"),
      [
        {
          table: "gallery_photos",
          operation: "insert",
          value: files.map((file, index) => ({
            ...file,
            gallery_id: galleryId,
            user_id: owner,
            width: file.width ?? null,
            height: file.height ?? null,
            sort_order: index + 1,
          })),
        },
      ],
    );
  } else if (scenario === 4 || scenario === 5) {
    photos = [
      freshPhoto(path),
      ...invalidPaths.map((value, i) => freshPhoto(value, `poison-${i}`)),
      { ...freshPhoto(path, "wrong-recipient"), user_id: other },
      { ...freshPhoto(path, "wrong-gallery"), gallery_id: otherGallery },
      freshPhoto(secondPath),
    ];
    const original = structuredClone(photos);
    signMode = "reverse";
    const reply = await (scenario === 4 ? open() : get());
    assert.deepEqual(signCalls, [[path, secondPath]]);
    const visible = original.filter((photo) => photo.gallery_id === galleryId);
    assert.equal(reply.photos?.length, visible.length);
    for (const photo of reply.photos ?? []) {
      const valid = photo.id === path || photo.id === secondPath;
      assert.equal(photo.url, valid ? `https://signed.example.invalid/${photo.id}` : null);
    }
    assert.deepEqual(photos, original, "Legacy records must remain intact");
    noPhotoWrites();
  } else if (scenario === 6) {
    photos = invalidPaths.map((value) => freshPhoto(value));
    assert.ok((await open()).photos?.every((photo) => photo.url === null));
    assert.ok((await get()).photos?.every((photo) => photo.url === null));
    assert.deepEqual(signCalls, []);
    noPhotoWrites();
  } else if (scenario === 7) {
    for (const mode of ["partial", "error", "throw"] as const) {
      reset();
      photos = [freshPhoto(path), freshPhoto(secondPath)];
      signMode = mode;
      const reply = await open();
      assert.equal(reply.photos?.[0].url, null);
      assert.equal(
        reply.photos?.[1].url,
        mode === "partial" ? `https://signed.example.invalid/${secondPath}` : null,
      );
      noPhotoWrites();
    }
  } else if (scenario === 8) {
    for (const patch of [
      { status: "draft" },
      { passcode: "private" },
      { expires_at: "2000-01-01T00:00:00.000Z" },
    ]) {
      reset();
      Object.assign(gallery, patch);
      assert.ok((await open()).error);
      assert.deepEqual(signCalls, []);
      assert.deepEqual(writes, []);
    }
  } else if (scenario === 9) {
    for (const fail of [false, true]) {
      reset();
      const files = Array.from({ length: 11 }, (_, index) => ({
        storage_path: `${owner}/${galleryId}/${generated}-${index}.jpg`,
        filename: `${index}.jpg`,
      }));
      for (const file of files) info.set(file.storage_path, goodInfo(file.storage_path));
      if (fail) info.delete(files[0]!.storage_path);
      const reply = await add(files);
      assert.equal(maxActiveInfo, 4);
      assert.equal(activeInfo, 0);
      if (fail) {
        assert.ok(reply.error);
        assert.equal(infoCalls.length, 4, "Do not admit another batch after storage failure");
        noPhotoWrites();
      } else {
        assert.equal(reply.added, 11);
        assert.deepEqual(
          infoCalls,
          files.map((file) => file.storage_path),
        );
      }
    }
  } else if (scenario === 10) {
    photos = [
      freshPhoto(path),
      freshPhoto(foreignPath),
      freshPhoto(`${owner}/${otherGallery}/${generated}-private.jpg`),
      { ...freshPhoto(secondPath), user_id: other },
      freshPhoto(path, "duplicate-valid-row"),
    ];
    const originals = structuredClone(photos);
    assert.equal((await remove()).error, undefined);
    assert.deepEqual(removeCalls, [[path]], "Never remove foreign or other-gallery originals");
    assert.deepEqual(writes, [{ table: "galleries", operation: "delete", value: undefined }]);
    assert.deepEqual(photos, originals, "No direct photo-row mutation in cleanup");
    reset();
    photos = [freshPhoto(foreignPath)];
    assert.equal((await remove()).error, undefined);
    assert.deepEqual(removeCalls, [], "A quarantined-only gallery must not touch storage");
  } else if (scenario === 11) {
    for (const mode of ["error", "throw", "photo-read-error"] as const) {
      reset();
      if (mode === "photo-read-error") photoReadError = true;
      else removeMode = mode;
      assert.ok((await remove()).error);
      assert.deepEqual(writes, [], "A failed cleanup must leave gallery metadata intact for retry");
      assert.deepEqual(removeCalls, mode === "photo-read-error" ? [] : [[path]]);
    }
  } else if (scenario === 12) {
    gallery.user_id = other;
    assert.ok((await remove()).error);
    assert.deepEqual(removeCalls, []);
    assert.deepEqual(writes, []);
  } else {
    throw new Error("Unknown fixture scenario");
  }
  process.stdout.write("GALLERY_SECURITY_OK\n");
}
