// Isolated PostgreSQL/RLS regression. Never connects to the configured database.
// node scripts/upload-security-sql-check.mjs /absolute/temp/node_modules/@electric-sql/pglite
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const runtime = process.argv[2];
if (!runtime || !runtime.startsWith("/"))
  throw new Error("Pass an absolute isolated PGlite package path");
const { PGlite } = await import(pathToFileURL(resolve(runtime, "dist/index.js")).href);
const db = new PGlite();
let checks = 0;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const gallery = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherGallery = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const generated = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const goodPath = `${owner}/${gallery}/${generated}-image.jpg`;
const foreignPath = `${other}/${otherGallery}/${generated}-secret.jpg`;
const reserved = `client-uploads/${owner}/${generated}-reference.jpg`;
const loadMigration = async (name) =>
  db.exec(await readFile(new URL(`../drizzle/migrations/${name}.sql`, import.meta.url), "utf8"));
const asUser = async (id, fn, role = "authenticated") => {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
};
const rejected = async (fn) => {
  await assert.rejects(fn, /permission denied|row-level security/);
  checks++;
};
const photoInsert = (path) =>
  db.query(
    "INSERT INTO gallery_photos(user_id,gallery_id,storage_path,filename) VALUES ($1,$2,$3,$4)",
    [owner, gallery, path, "image.jpg"],
  );
const uploadInsert = (path) =>
  db.query("INSERT INTO client_uploads(uploader_email,storage_path,filename) VALUES ($1,$2,$3)", [
    "owner@example.test",
    path,
    "reference.jpg",
  ]);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('email','owner@example.test') $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE TABLE clients(id uuid PRIMARY KEY, user_id uuid, auth_user_id uuid);
    CREATE TABLE shoots(id uuid PRIMARY KEY, client_id uuid);
    CREATE TABLE invoices(id uuid PRIMARY KEY, client_id uuid);
    GRANT SELECT ON clients,shoots,invoices TO authenticated;
    CREATE FUNCTION public.my_client_ids() RETURNS SETOF uuid LANGUAGE sql AS $$ SELECT id FROM clients WHERE auth_user_id=auth.uid() $$;
    CREATE FUNCTION public.handle_new_user() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
    GRANT ALL ON storage.objects TO service_role;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  `);
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES ($1,'owner@example.test'),($2,'other@example.test')",
    [owner, other],
  );
  for (const name of [
    "0002_client_delivery_galleries",
    "0003_deliveries_storage_policies",
    "0005_client_bookings_and_uploads",
    "0006_security_hardening_client_linkage_and_bridge",
    "0008_guest_shoot_access_tokens",
    "0013_gallery_photos_passcode_gate",
  ])
    await loadMigration(name);
  await db.query(
    "INSERT INTO galleries(id,user_id,slug,title) VALUES ($1,$2,$3,$3),($4,$5,$6,$6)",
    [gallery, owner, "owner-gallery", otherGallery, other, "other-gallery"],
  );
  await db.query(
    "INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ($1,$2,$3),($1,$4,$3),($1,$5,$3)",
    ["deliveries", goodPath, { size: 12 }, foreignPath, reserved],
  );

  // Meaningful failing-first baseline: old policies accept a foreign private key.
  await asUser(owner, async () => {
    await photoInsert(foreignPath);
    await uploadInsert(foreignPath);
  });
  checks += 2;
  const booking = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.query(
    "INSERT INTO booking_requests(id,requester_email,access_token) VALUES ($1,$2,$3)",
    [booking, "owner@example.test", "fixture-private-guest-token"],
  );
  await asUser(owner, async () => {
    assert.equal(
      (await db.query("SELECT access_token FROM booking_requests WHERE id=$1", [booking])).rows[0]
        .access_token,
      "fixture-private-guest-token",
    );
    checks++;
  });
  await db.query(
    "INSERT INTO client_uploads(booking_id,uploader_email,storage_path,filename) VALUES ($1,$2,$3,$4)",
    [
      booking,
      "owner@example.test",
      `shoot-refs/${booking}/${generated}-reference.jpg`,
      "reference.jpg",
    ],
  );
  const before = (
    await db.query(
      "SELECT id,storage_path FROM gallery_photos UNION ALL SELECT id,storage_path FROM client_uploads ORDER BY id",
    )
  ).rows;
  await loadMigration("0022_upload_path_ownership");
  await loadMigration("0022_upload_path_ownership"); // safe reapplication after a reviewed hotfix
  await asUser(owner, async () => {
    assert.equal(
      (await db.query("SELECT access_token FROM booking_requests WHERE id=$1", [booking])).rows
        .length,
      0,
    );
    checks++;
    await rejected(() => db.exec("TRUNCATE client_uploads"));
    await rejected(() => db.exec("TRUNCATE gallery_photos"));
  });
  await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1", [owner]);
  await asUser(owner, async () => {
    assert.equal(
      (await db.query("SELECT access_token FROM booking_requests WHERE id=$1", [booking])).rows[0]
        .access_token,
      "fixture-private-guest-token",
    );
    checks++;
    assert.equal(
      (await db.query("SELECT filename FROM client_uploads WHERE booking_id=$1", [booking])).rows
        .length,
      1,
    );
    checks++;
    assert.equal(
      (
        await db.query("SELECT public.verified_booking_email($1) AS verified", [
          "other@example.test",
        ])
      ).rows[0].verified,
      false,
    );
    checks++;
  });
  await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1", [other]);
  await asUser(other, async () => {
    // The forged JWT email still says owner@example.test; actual Auth email wins.
    assert.equal(
      (await db.query("SELECT access_token FROM booking_requests WHERE id=$1", [booking])).rows
        .length,
      0,
    );
    checks++;
  });
  await asUser(
    owner,
    () =>
      rejected(() => db.query("SELECT public.verified_booking_email($1)", ["owner@example.test"])),
    "anon",
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT id,storage_path FROM gallery_photos UNION ALL SELECT id,storage_path FROM client_uploads ORDER BY id",
      )
    ).rows,
    before,
  );
  checks++;
  assert.equal(
    (
      await db.query(
        "SELECT has_table_privilege('authenticated','client_uploads','INSERT,UPDATE,DELETE') AS permitted",
      )
    ).rows[0].permitted,
    false,
  );
  checks++;
  await asUser(owner, async () => {
    await rejected(() => uploadInsert(reserved));
    await rejected(() => db.query("UPDATE client_uploads SET storage_path=$1", [reserved]));
    await rejected(() => db.exec("DELETE FROM client_uploads"));
    await photoInsert(goodPath);
    checks++;
    for (const path of [
      foreignPath,
      `${owner}/${otherGallery}/${generated}-image.jpg`,
      `${goodPath}\n`,
      `${goodPath}/extra`,
      `${owner}/${gallery}/../secret`,
      `${owner}/${gallery}/${generated}-%2e.jpg`,
      `${owner}/${gallery}/${generated}-missing.jpg`,
    ])
      await rejected(() => photoInsert(path));
    await rejected(() =>
      db.query("UPDATE gallery_photos SET storage_path=$1 WHERE storage_path=$2", [
        foreignPath,
        goodPath,
      ]),
    );
    assert.equal(
      (
        await db.query("SELECT count(*)::int AS n FROM gallery_photos WHERE storage_path=$1", [
          foreignPath,
        ])
      ).rows[0].n,
      1,
    );
    checks++;
  });
  // Even an accidentally over-broad future grant/policy cannot bypass guards.
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON client_uploads TO authenticated,anon;
    CREATE POLICY accidental_upload_access ON client_uploads FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon;
    CREATE POLICY accidental_storage_access ON storage.objects FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);`);
  for (const role of ["authenticated", "anon"])
    await asUser(
      owner,
      async () => {
        await rejected(() => uploadInsert(reserved));
        assert.equal(
          (await db.query("UPDATE client_uploads SET filename=$1 RETURNING id", ["changed.jpg"]))
            .rows.length,
          0,
        );
        checks++;
        assert.equal((await db.query("DELETE FROM client_uploads RETURNING id")).rows.length, 0);
        checks++;
      },
      role,
    );
  await asUser(owner, async () => {
    await rejected(() =>
      db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ($1,$2,$3)", [
        "deliveries",
        `shoot-refs/${gallery}/${generated}-x.jpg`,
        { size: 5 },
      ]),
    );
    await rejected(() =>
      db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ($1,$2,$3)", [
        "deliveries",
        foreignPath,
        { size: 5 },
      ]),
    );
    await rejected(() =>
      db.query("UPDATE storage.objects SET name=$1 WHERE name=$2", [reserved, goodPath]),
    );
    assert.equal(
      (await db.query("DELETE FROM storage.objects WHERE name=$1 RETURNING id", [foreignPath])).rows
        .length,
      0,
    );
    checks++;
    // A normal owned upload still works despite the namespace guard.
    await db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ($1,$2,$3)", [
      "deliveries",
      `${owner}/${gallery}/${generated}-new.jpg`,
      { size: 7 },
    ]);
    checks++;
  });
  await asUser(
    "",
    () =>
      rejected(() =>
        db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ($1,$2,$3)", [
          "deliveries",
          reserved,
          { size: 10 },
        ]),
      ),
    "anon",
  );
  for (const size of [0, -1, "broken", null, "1.5", "99999999999999999999999999"]) {
    const path = `${owner}/${gallery}/${generated}-size-${checks}.jpg`;
    await db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ($1,$2,$3)", [
      "deliveries",
      path,
      { size },
    ]);
    await asUser(owner, () => rejected(() => photoInsert(path)));
  }
  await asUser(
    owner,
    async () => {
      await uploadInsert(reserved);
      checks++;
    },
    "service_role",
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT id,storage_path FROM gallery_photos UNION ALL SELECT id,storage_path FROM client_uploads ORDER BY id",
      )
    ).rows.filter((r) => before.some((b) => b.id === r.id)),
    before,
  );
  checks++;
  console.log(
    `Upload PostgreSQL security: ${checks} assertions passed; old bypass reproduced, existing records preserved.`,
  );
} finally {
  await db.close();
}
