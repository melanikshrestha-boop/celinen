import { expect, test } from "bun:test";

// The real handlers run against an isolated, in-memory service boundary. Module
// mocks must not leak into unrelated tests or ever reach customer storage.
if (!process.argv.includes("--fixture"))
  test("reserved upload handlers enforce ownership before storage access", () => {
    const result = Bun.spawnSync([process.execPath, import.meta.path, "--fixture"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(result.stdout)).scenarios).toBeGreaterThanOrEqual(
      50,
    );
  });

if (process.argv.includes("--fixture")) {
  const { mock } = await import("bun:test");
  const assert = (await import("node:assert/strict")).default;
  const uid = "10000000-0000-4000-8000-000000000001";
  const foreign = "20000000-0000-4000-8000-000000000002";
  const nonce = "30000000-0000-4000-8000-000000000003";
  const studio = "40000000-0000-4000-8000-000000000004";
  const clientId = "50000000-0000-4000-8000-000000000005";
  const bookingId = "60000000-0000-4000-8000-000000000006";
  const token = "a".repeat(40);
  const ownPath = `client-uploads/${uid}/${nonce}-photo.jpg`;
  const guestPath = `shoot-refs/${bookingId}/${nonce}-photo.jpg`;
  const inserted: Record<string, any>[] = [];
  const storageCalls: string[] = [];
  const signedCalls: string[][] = [];
  const issued: string[] = [];
  let user: any;
  let authError = false;
  let signError = false;
  let insertError = false;
  let objectValue: any;
  let objectError = false;
  const tables: Record<string, Record<string, any>[]> = {};
  const lookupErrors = new Set<string>();
  function reset() {
    user = { id: uid, email: "client@example.test", email_confirmed_at: "2026-01-01" };
    authError = signError = objectError = insertError = false;
    objectValue = undefined;
    inserted.length = storageCalls.length = signedCalls.length = issued.length = 0;
    lookupErrors.clear();
    tables.clients = [{ id: clientId, user_id: studio, auth_user_id: uid }];
    tables.booking_requests = [
      {
        id: bookingId,
        access_token: token,
        client_id: null,
        user_id: null,
        requester_email: "guest@example.test",
        gallery_id: null,
      },
    ];
    tables.client_uploads = [];
  }
  reset();
  const db = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user },
          error: authError ? { message: "auth unavailable" } : null,
        }),
      },
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const result = () => ({
        data: (tables[table] ?? []).filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        ),
        error: lookupErrors.has(table) ? { message: "lookup failed" } : null,
      });
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        limit: () => query,
        order: () => query,
        maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        insert: async (row: Record<string, any>) => {
          if (insertError) return { error: { message: "insert failed" } };
          inserted.push(row);
          (tables[table] ??= []).push({ id: `fixture-${inserted.length}`, ...row });
          return { error: null };
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        info: async (path: string) => {
          storageCalls.push(path);
          return {
            data:
              objectValue === undefined
                ? { name: path, bucketId: "deliveries", size: 32 }
                : objectValue,
            error: objectError ? { message: "storage unavailable" } : null,
          };
        },
        createSignedUrls: async (paths: string[]) => {
          signedCalls.push(paths);
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://fixture.invalid/${path}`,
              error: null,
            })),
            error: signError ? { message: "signing unavailable" } : null,
          };
        },
        createSignedUploadUrl: async (path: string) => {
          issued.push(path);
          return {
            data: { path, token: "signed-fixture", signedUrl: "https://fixture.invalid/upload" },
            error: null,
          };
        },
      }),
    },
  };
  mock.module("@tanstack/react-start", () => ({
    createServerFn: () => {
      let validator = (data: unknown) => data;
      const builder: any = {
        middleware: () => builder,
        inputValidator: (fn: typeof validator) => {
          validator = fn;
          return builder;
        },
        handler: (fn: any) => (input: any) => fn({ ...input, data: validator(input.data) }),
      };
      return builder;
    },
  }));
  mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
  globalThis.fetch = async () => {
    throw new Error("Unexpected real network call");
  };
  const portal = await import("../src/lib/client-portal.functions");
  const guest = await import("../src/lib/shoot-app.functions");
  const security = await import("../src/lib/upload-security");
  const record = portal.recordClientUpload as any;
  const context = (id = uid) => ({
    userId: id,
    claims: { email: "spoofed-claim@example.test" },
    supabase: db,
  });
  const clientRecord = (patch: any = {}) =>
    record({
      data: { storage_path: ownPath, filename: "photo.jpg", ...patch },
      context: context(),
    });
  const guestRecord = (patch: any = {}) =>
    (guest.recordShootUpload as any)({
      data: { token, storage_path: guestPath, filename: "photo.jpg", ...patch },
    });
  const list = (id = uid) => (portal.listClientUploads as any)({ context: context(id) });
  const space = (value: unknown = token) =>
    (guest.getShootSpace as any)({ data: { token: value } });
  const row = (patch: any = {}) => ({
    id: "preserved-row",
    storage_path: ownPath,
    filename: "photo.jpg",
    note: null,
    created_at: "2026-01-01",
    client_id: null,
    user_id: null,
    booking_id: null,
    uploader_email: "client@example.test",
    ...patch,
  });
  let scenarios = 0;
  const check = async (name: string, run: () => unknown | Promise<unknown>) => {
    reset();
    try {
      await run();
      scenarios++;
    } catch (error) {
      throw new Error(name, { cause: error });
    }
  };

  for (const path of [
    `client-uploads/${foreign}/${nonce}-photo.jpg`,
    `${studio}/gallery/private.jpg`,
    `client-uploads/${uid}/../${foreign}/${nonce}-photo.jpg`,
    `client-uploads/${uid}/%2e%2e/private.jpg`,
    ownPath.replace("/photo", "//photo") + "/extra",
    ownPath + "\0",
    ownPath + "\n",
    ownPath + "\r\n",
    ownPath + "?download=1",
    ownPath.replace("client-uploads/", "client-uploads//"),
    ownPath.replace("/", "\\"),
    ownPath.replace("photo.jpg", "%70hoto.jpg"),
    guestPath,
    null,
    123,
  ])
    await check(`reject foreign or noncanonical key ${String(path)}`, async () => {
      assert.ok((await clientRecord({ storage_path: path })).error);
      assert.equal(inserted.length, 0);
      assert.equal(storageCalls.length, 0, "no service-role object probe before ownership");
    });
  await check("valid account upload stays unassigned without a destination", async () => {
    assert.deepEqual(await clientRecord(), { ok: true });
    assert.equal(inserted[0]?.client_id, null);
    assert.equal(inserted[0]?.user_id, null);
    assert.equal(
      inserted[0]?.uploader_email,
      "client@example.test",
      "actual Auth email, never claims",
    );
  });
  await check("explicit verified client destination only", async () => {
    assert.deepEqual(await clientRecord({ client_id: clientId }), { ok: true });
    assert.equal(inserted[0]?.client_id, clientId);
    assert.equal(inserted[0]?.user_id, studio);
  });
  await check("foreign selected client fails before object probe", async () => {
    tables.clients![0]!.auth_user_id = foreign;
    assert.ok((await clientRecord({ client_id: clientId })).error);
    assert.equal(storageCalls.length, 0);
  });
  for (const broken of [
    null,
    { name: ownPath, bucketId: "deliveries", size: 0 },
    { name: ownPath, bucketId: "other", size: 2 },
    { name: guestPath, bucketId: "deliveries", size: 2 },
    { name: ownPath, bucketId: "deliveries", size: "2" },
  ])
    await check("incomplete or wrong object never records", async () => {
      objectValue = broken;
      assert.ok((await clientRecord()).error);
      assert.equal(inserted.length, 0);
    });
  await check("storage error with stale data fails closed", async () => {
    objectError = true;
    assert.ok((await clientRecord()).error);
    assert.equal(inserted.length, 0);
  });
  await check("unverified Auth cannot issue or record", async () => {
    user.email_confirmed_at = null;
    assert.ok((await clientRecord()).error);
    assert.ok(
      (
        await (portal.createClientUploadUrl as any)({
          data: { filename: "photo.jpg" },
          context: context(),
        })
      ).error,
    );
    assert.equal(storageCalls.length + issued.length, 0);
  });
  await check("retry same account key does not duplicate", async () => {
    assert.deepEqual(await clientRecord(), { ok: true });
    assert.deepEqual(await clientRecord(), { ok: true });
    assert.equal(inserted.length, 1);
    assert.ok(
      (await clientRecord({ client_id: clientId })).error,
      "cannot reassign existing upload",
    );
  });
  await check("lookup and insert errors are not successful saves", async () => {
    lookupErrors.add("client_uploads");
    assert.ok((await clientRecord()).error);
    lookupErrors.clear();
    insertError = true;
    assert.ok((await clientRecord()).error);
    assert.equal(inserted.length, 0);
  });
  await check("portal preserves poisoned rows but never signs them", async () => {
    tables.client_uploads = [
      row(),
      row({ storage_path: `client-uploads/${foreign}/${nonce}-photo.jpg` }),
      row({ storage_path: `${studio}/gallery/private.jpg` }),
      row({ client_id: clientId, user_id: foreign }),
      row({ booking_id: bookingId }),
      row({ storage_path: ownPath + "/../secret" }),
    ];
    const result = await list();
    assert.equal(result.length, 6);
    assert.ok(result[0].url);
    assert.ok(result.slice(1).every((item: any) => item.url === null));
    assert.deepEqual(signedCalls, [[ownPath]]);
  });
  await check("photographer only reads auth-linked upload and matching studio", async () => {
    user = { ...user, id: studio, email: "studio@example.test" };
    tables.client_uploads = [
      row({ client_id: clientId, user_id: studio }),
      row({ user_id: studio }),
      row({
        client_id: clientId,
        user_id: studio,
        storage_path: `client-uploads/${foreign}/${nonce}-photo.jpg`,
      }),
    ];
    const result = await list(studio);
    assert.ok(result[0].url);
    assert.equal(result[1].url, null);
    assert.equal(result[2].url, null);
    assert.deepEqual(signedCalls, [[ownPath]]);
  });
  await check("missing client binding and failed signer fail closed", async () => {
    tables.client_uploads = [row({ client_id: clientId, user_id: studio })];
    lookupErrors.add("clients");
    assert.equal((await list())[0].url, null);
    assert.equal(signedCalls.length, 0);
    lookupErrors.clear();
    signError = true;
    assert.equal((await list())[0].url, null);
  });
  await check("auth lookup error and unverified viewers never sign", async () => {
    tables.client_uploads = [row()];
    authError = true;
    assert.equal((await list())[0].url, null);
    authError = false;
    user.email_confirmed_at = null;
    assert.equal((await list())[0].url, null);
    assert.equal(signedCalls.length, 0);
  });
  await check("guest upload works without an account and retries safely", async () => {
    assert.deepEqual(await guestRecord(), { ok: true });
    assert.deepEqual(await guestRecord(), { ok: true });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.booking_id, bookingId);
    assert.equal(inserted[0]?.client_id, null);
  });
  for (const path of [
    ownPath,
    guestPath.replace(bookingId, foreign),
    `shoot-refs/${bookingId}/../private.jpg`,
    guestPath + "/extra",
    guestPath.replace("photo.jpg", "%2e%2e"),
    null,
  ])
    await check("guest rejects wrong namespace before storage", async () => {
      assert.ok((await guestRecord({ storage_path: path })).error);
      assert.equal(inserted.length + storageCalls.length, 0);
    });
  for (const invalidToken of [
    123,
    null,
    {},
    "a".repeat(201),
    token + " ",
    token + "/",
    token + "\n",
    token + "\r\n",
  ])
    await check("malformed capability fails closed", async () => {
      assert.equal((await space(invalidToken)).error, "not_found");
      assert.ok((await guestRecord({ token: invalidToken })).error);
      assert.equal(storageCalls.length + signedCalls.length, 0);
    });
  await check("guest poisoned legacy rows remain visible but unsigned", async () => {
    const good = row({
      storage_path: guestPath,
      booking_id: bookingId,
      uploader_email: "guest@example.test",
    });
    tables.client_uploads = [
      good,
      { ...good, storage_path: ownPath },
      { ...good, client_id: clientId },
      { ...good, user_id: studio },
      { ...good, uploader_email: "other@example.test" },
      { ...good, storage_path: guestPath.replace(bookingId, foreign) },
    ];
    const result = await space();
    assert.equal(result.uploads.length, 6);
    assert.ok(result.uploads[0].url);
    assert.ok(result.uploads.slice(1).every((item: any) => item.url === null));
    assert.deepEqual(signedCalls, [[guestPath]]);
  });
  await check("guest missing or errored object cannot record", async () => {
    objectValue = null;
    assert.ok((await guestRecord()).error);
    assert.equal(inserted.length, 0);
  });
  await check("guest lookup and signing errors never leak URLs", async () => {
    tables.client_uploads = [
      row({ storage_path: guestPath, booking_id: bookingId, uploader_email: "guest@example.test" }),
    ];
    signError = true;
    assert.equal((await space()).uploads[0].url, null);
    lookupErrors.add("booking_requests");
    assert.equal((await space()).error, "not_found");
  });
  await check("verified requester and assigned studio can read exact guest bindings", async () => {
    const booking = tables.booking_requests![0]!;
    booking.client_id = clientId;
    booking.user_id = studio;
    user.email = "guest@example.test";
    tables.client_uploads = [
      row({
        storage_path: guestPath,
        booking_id: bookingId,
        client_id: clientId,
        user_id: studio,
        uploader_email: "guest@example.test",
      }),
    ];
    assert.ok((await list())[0].url);
    user = { ...user, id: studio, email: "studio@example.test" };
    assert.ok((await list(studio))[0].url);
    tables.clients![0]!.user_id = foreign;
    assert.equal((await list(studio))[0].url, null);
  });
  await check("issuer keys are canonical and bind file names", async () => {
    const result = await (portal.createClientUploadUrl as any)({
      data: { filename: "reference photo.jpg" },
      context: context(),
    });
    assert.equal(security.parseReservedUploadPath(result.path)?.ownerId, uid);
    assert.equal(result.client_id, null);
    const guestResult = await (guest.createShootUploadUrl as any)({
      data: { token, filename: "photo.jpg" },
    });
    assert.equal(security.parseReservedUploadPath(guestResult.path)?.ownerId, bookingId);
    assert.ok((await clientRecord({ filename: "different.jpg" })).error);
  });
  await check("runtime filenames and destination IDs are validated", async () => {
    for (const filename of [null, 42, "", "../secret", "a".repeat(201), "bad\0.jpg"])
      await assert.rejects(async () => clientRecord({ filename }));
    await assert.rejects(async () => clientRecord({ client_id: "not-a-client" }));
    await assert.rejects(async () => clientRecord({ client_id: clientId + "\n" }));
    assert.equal(storageCalls.length + inserted.length, 0);
  });
  process.stdout.write(JSON.stringify({ scenarios }));
}
