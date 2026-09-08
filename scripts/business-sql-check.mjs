// Isolated PostgreSQL only. Does not read credentials or contact production.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const runtime = process.argv[2];
if (!runtime?.startsWith("/")) throw new Error("Pass the isolated PGlite runtime path.");
const { PGlite } = await import(
  pathToFileURL(resolve(runtime, "node_modules/@electric-sql/pglite/dist/index.js")).href
);
const db = new PGlite();
let assertions = 0;
const equal = (actual, expected) => {
  assert.equal(actual, expected);
  assertions++;
};
const ok = (value) => {
  assert.ok(value);
  assertions++;
};
const rejects = async (run) => {
  await assert.rejects(run);
  assertions++;
};
try {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);",
  );
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0018_business_publishing.sql", import.meta.url),
      "utf8",
    ),
  );
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1),($2)", [owner, other]);
  const state = {
    version: 1,
    revision: 0,
    updatedAt: null,
    clients: [{ id: "client-1", name: "Test" }],
  };
  const save = async (who, s) =>
    (
      await db.query("SELECT public.business_save_clients($1,$2::jsonb,$3) AS state", [
        who,
        JSON.stringify(s),
        s.revision,
      ])
    ).rows[0].state;
  await db.exec("SET ROLE service_role");
  const saved = await save(owner, state);
  equal(saved.revision, 1);
  await rejects(() => save(owner, state));
  await rejects(() => save(owner, { ...saved, clients: [] }));
  const changed = await save(owner, {
    ...saved,
    clients: [{ ...saved.clients[0], followUpOn: "2026-09-10" }],
  });
  equal(changed.revision, 2);
  const second = await save(other, state);
  equal(second.revision, 1);
  await db.exec("RESET ROLE");
  // Upgrade after pre-existing business data exists, not only on an empty schema.
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0021_facebook_social_connections.sql", import.meta.url),
      "utf8",
    ),
  );
  const facebook = "public.facebook_social_connections";
  const credential = async (who, text, expires = "2027-01-01T00:00:00Z") =>
    db.query(`INSERT INTO ${facebook}(owner_id,pages_credential,expires_at) VALUES($1,$2,$3)`, [
      who,
      text,
      expires,
    ]);
  const deletedOwner = crypto.randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)", [deletedOwner]);
  await db.exec("SET ROLE service_role");
  await credential(owner, "x".repeat(200000));
  await credential(other, "other-owner-encrypted-fixture");
  await credential(deletedOwner, "cascade-fixture");
  equal(
    Number(
      (
        await db.query(
          `SELECT octet_length(pages_credential) AS n FROM ${facebook} WHERE owner_id=$1`,
          [owner],
        )
      ).rows[0].n,
    ),
    200000,
  );
  await rejects(() => credential(owner, "duplicate-primary-key"));
  await rejects(() => credential(crypto.randomUUID(), "missing-owner"));
  await rejects(() =>
    db.query(`UPDATE ${facebook} SET pages_credential=$1 WHERE owner_id=$2`, [
      "x".repeat(200001),
      owner,
    ]),
  );
  await rejects(() =>
    db.query(`UPDATE ${facebook} SET pages_credential=$1 WHERE owner_id=$2`, [
      "界".repeat(66667),
      owner,
    ]),
  );
  await rejects(() =>
    db.query(`UPDATE ${facebook} SET pages_credential=NULL WHERE owner_id=$1`, [owner]),
  );
  await rejects(() =>
    db.query(`UPDATE ${facebook} SET expires_at=NULL WHERE owner_id=$1`, [owner]),
  );
  equal(
    (await db.query(`SELECT pages_credential FROM ${facebook} WHERE owner_id=$1`, [other])).rows[0]
      .pages_credential,
    "other-owner-encrypted-fixture",
  );
  equal(
    (
      await db.query(
        "SELECT state->>'revision' AS revision FROM public.business_clients WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].revision,
    "2",
  );
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM auth.users WHERE id=$1", [deletedOwner]);
  equal(Number((await db.query(`SELECT count(*) AS n FROM ${facebook}`)).rows[0].n), 2);
  for (const role of ["anon", "authenticated"])
    for (const operation of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      equal(
        (
          await db.query("SELECT has_table_privilege($1,$2,$3) AS allowed", [
            role,
            facebook,
            operation,
          ])
        ).rows[0].allowed,
        false,
      );
  // Even an accidental future SELECT grant must not bypass the policy-free RLS boundary.
  await db.exec(
    `BEGIN; GRANT SELECT ON ${facebook} TO authenticated; SET LOCAL ROLE authenticated;`,
  );
  equal(Number((await db.query(`SELECT count(*) AS n FROM ${facebook}`)).rows[0].n), 0);
  await db.exec("ROLLBACK");
  const enabled = await db.query(
    "SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('business_clients','social_connections','social_oauth_states','social_publications','facebook_social_connections')",
  );
  equal(enabled.rows.length, 5);
  ok(enabled.rows.every((row) => row.relrowsecurity));
  const bucket = (await db.query("SELECT * FROM storage.buckets")).rows[0];
  equal(bucket.public, false);
  equal(Number(bucket.file_size_limit), 8388608);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of [
      "business_clients",
      "social_connections",
      "social_oauth_states",
      "social_publications",
      "facebook_social_connections",
    ])
      await rejects(() => db.query(`SELECT * FROM public.${table}`));
    await rejects(() => save(owner, changed));
    await db.exec("RESET ROLE");
  }
  console.log(
    `${assertions} Business SQL assertions passed: upgrade preservation, credential byte/FK/null/PK constraints, cascading owner cleanup, five RLS tables, denied grants, revision/no-delete guards and private JPEG bucket.`,
  );
} finally {
  await db.close();
}
