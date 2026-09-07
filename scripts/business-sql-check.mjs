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
  assert.equal(saved.revision, 1);
  await assert.rejects(() => save(owner, state));
  await assert.rejects(() => save(owner, { ...saved, clients: [] }));
  const changed = await save(owner, {
    ...saved,
    clients: [{ ...saved.clients[0], followUpOn: "2026-09-10" }],
  });
  assert.equal(changed.revision, 2);
  const second = await save(other, state);
  assert.equal(second.revision, 1);
  await db.exec("RESET ROLE");
  const enabled = await db.query(
    "SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('business_clients','social_connections','social_oauth_states','social_publications')",
  );
  assert.equal(enabled.rows.length, 4);
  assert.ok(enabled.rows.every((row) => row.relrowsecurity));
  const bucket = (await db.query("SELECT * FROM storage.buckets")).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 8388608);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of [
      "business_clients",
      "social_connections",
      "social_oauth_states",
      "social_publications",
    ])
      await assert.rejects(() => db.query(`SELECT * FROM public.${table}`));
    await assert.rejects(() => save(owner, changed));
    await db.exec("RESET ROLE");
  }
  console.log(
    "Business SQL passed: revision conflicts, no-delete guard, owner separation, four RLS tables, private JPEG bucket, denied anonymous/authenticated direct access.",
  );
} finally {
  await db.close();
}
