// Isolated database only; never reads hosting credentials or contacts production.
// node scripts/workspace-search-sql-check.mjs /absolute/test-runtime-with-pglite
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const runtime = process.argv[2];
if (!runtime?.startsWith("/")) throw new Error("Pass an absolute isolated test-runtime directory.");
const { PGlite } = await import(
  pathToFileURL(resolve(runtime, "node_modules/@electric-sql/pglite/dist/index.js")).href
);
const db = new PGlite();
let assertions = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  assertions++;
};
const rpc = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const take = (owner, lease = crypto.randomUUID()) =>
  rpc("SELECT public.workspace_take_search($1,$2) AS result", [owner, lease]);
const release = (lease) => rpc("SELECT public.workspace_release_search($1) AS result", [lease]);
const empty = () =>
  db.exec("TRUNCATE public.workspace_search_usage, public.workspace_search_leases");
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0016_workspace_search_limits.sql", import.meta.url),
      "utf8",
    ),
  );
  const owner = crypto.randomUUID();
  for (let i = 0; i < 8; i++) {
    const lease = crypto.randomUUID();
    check(await take(owner, lease), true);
    await release(lease);
  }
  check(await take(owner), false);
  check(await take(crypto.randomUUID()), true);
  await empty();
  const leases = Array.from({ length: 4 }, () => crypto.randomUUID());
  for (const lease of leases) check(await take(crypto.randomUUID(), lease), true);
  check(await take(crypto.randomUUID()), false);
  await release(crypto.randomUUID());
  check(await take(crypto.randomUUID()), false);
  await release(leases[0]);
  check(await take(crypto.randomUUID()), true);
  await db.exec("UPDATE public.workspace_search_leases SET expires_at=now()-interval '1 second'");
  check(await take(crypto.randomUUID()), true);
  await empty();
  for (let i = 0; i < 60; i++) {
    const lease = crypto.randomUUID();
    check(await take(crypto.randomUUID(), lease), true);
    await release(lease);
  }
  check(await take(crypto.randomUUID()), false);
  await db.exec(
    "UPDATE public.workspace_search_usage SET started_at=now()-interval '61 seconds' WHERE bucket='global:minute'",
  );
  const lease = crypto.randomUUID();
  check(await take(owner, lease), true);
  await release(lease);
  await db.exec("UPDATE public.workspace_search_usage SET requests=1000 WHERE bucket='global:day'");
  check(await take(crypto.randomUUID()), false);
  await db.exec(
    "UPDATE public.workspace_search_usage SET started_at=now()-interval '25 hours' WHERE bucket='global:day'",
  );
  check(await take(crypto.randomUUID()), true);
  check(await take(null), false);
  for (const role of ["anon", "authenticated"]) {
    check(
      await rpc(
        "SELECT has_function_privilege($1,'public.workspace_take_search(uuid,uuid)','EXECUTE') AS result",
        [role],
      ),
      false,
    );
    check(
      await rpc(
        "SELECT has_function_privilege($1,'public.workspace_release_search(uuid)','EXECUTE') AS result",
        [role],
      ),
      false,
    );
    check(
      await rpc(
        "SELECT has_table_privilege($1,'public.workspace_search_usage','SELECT,INSERT,UPDATE,DELETE') AS result",
        [role],
      ),
      false,
    );
    check(
      await rpc(
        "SELECT has_table_privilege($1,'public.workspace_search_leases','SELECT,INSERT,UPDATE,DELETE') AS result",
        [role],
      ),
      false,
    );
  }
  check(
    await rpc(
      "SELECT has_function_privilege('service_role','public.workspace_take_search(uuid,uuid)','EXECUTE') AS result",
    ),
    true,
  );
  check(
    await rpc(
      "SELECT bool_and(relrowsecurity) AS result FROM pg_class WHERE relname IN ('workspace_search_usage','workspace_search_leases')",
    ),
    true,
  );
  console.log(`Workspace search database: ${assertions} assertions passed (isolated PGlite).`);
} finally {
  await db.close();
}
