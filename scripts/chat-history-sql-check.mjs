// Isolated PostgreSQL engine, no hosting credentials or production requests.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const runtime = process.argv[2];
if (!runtime?.startsWith("/")) throw new Error("Pass an absolute PGlite runtime directory.");
const { PGlite } = await import(
  pathToFileURL(resolve(runtime, "node_modules/@electric-sql/pglite/dist/index.js")).href
);
const db = new PGlite();
let assertions = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  assertions++;
};
const a = crypto.randomUUID(),
  b = crypto.randomUUID();
const identity = async (id) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("SET ROLE authenticated");
};
const save = async (record) =>
  (
    await db.query("SELECT public.save_workspace_chat($1::jsonb) AS result", [
      JSON.stringify(record),
    ])
  ).rows[0].result;
const fresh = () => ({
  id: crypto.randomUUID(),
  project: "current",
  title: "New chat",
  named: false,
  archived: false,
  revision: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [{ role: "user", text: "Warm the selected photo" }],
  draft: "",
});
const denied = async (fn) => {
  await assert.rejects(fn);
  assertions++;
};
try {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated, anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;",
  );
  await db.query("INSERT INTO auth.users VALUES($1),($2)", [a, b]);
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0017_private_workspace_chats.sql", import.meta.url),
      "utf8",
    ),
  );
  await identity(a);
  const original = fresh(),
    saved = await save(original);
  check(saved.revision, 1);
  check((await db.query("SELECT count(*)::int AS n FROM public.workspace_chats")).rows[0].n, 1);
  await denied(() => save(original)); // stale revision
  await denied(() => db.query("UPDATE public.workspace_chats SET record='{}'::jsonb"));
  await denied(() =>
    db.query(
      "INSERT INTO public.workspace_chats(id,owner_id,project,record) VALUES($1,$2,'current','{}')",
      [crypto.randomUUID(), b],
    ),
  );
  await identity(b);
  check((await db.query("SELECT count(*)::int AS n FROM public.workspace_chats")).rows[0].n, 0);
  await denied(() => save(saved)); // not the owner
  const other = await save(fresh());
  check(other.revision, 1);
  await identity(a);
  const archived = await save({ ...saved, archived: true, named: true, title: "Sports final" });
  check(archived.revision, 2);
  check(archived.messages, original.messages);
  const restored = await save({ ...archived, archived: false });
  check(restored.revision, 3);
  for (const patch of [
    { title: {} },
    { title: null },
    { project: {} },
    { messages: [{}] },
    { messages: [{ role: "system", text: "unsafe" }] },
    { messages: [{ role: null, text: "bad" }] },
    { messages: [{ role: "user", text: "hello", tool_calls: [] }] },
    { messages: [{ role: "assistant", text: "receipt", tools: [{ name: 1, result: "bad" }] }] },
    { messages: [{ role: "user", text: "x".repeat(32001) }] },
    { createdAt: null },
    { updatedAt: -1 },
    { revision: -1 },
    { owner_id: b },
    { draft: "search my Gmail for private-client" },
  ])
    await denied(() => save({ ...fresh(), ...patch }));
  const missingTime = fresh();
  delete missingTime.createdAt;
  await denied(() => save(missingTime));
  const missingTitle = fresh();
  delete missingTitle.title;
  await denied(() => save(missingTitle));
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE public.workspace_chat_write_limits SET writes=300,window_started=now() WHERE owner_id=$1",
    [a],
  );
  await identity(a);
  await denied(() => save(fresh()));
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE public.workspace_chat_write_limits SET window_started=now()-interval '2 minutes' WHERE owner_id=$1",
    [a],
  );
  await identity(a);
  check((await save(fresh())).revision, 1);
  await db.exec("RESET ROLE");
  // Build the exact owner-row admission boundary in this disposable database.
  for (let i = 0; i < 498; i++) {
    const record = fresh();
    await db.query(
      "INSERT INTO public.workspace_chats(id,owner_id,project,record) VALUES($1,$2,$3,$4)",
      [record.id, a, record.project, JSON.stringify(record)],
    );
  }
  await identity(a);
  await denied(() => save(fresh()));
  check((await save({ ...restored, title: "Still editable at quota" })).revision, 4);
  await db.exec("RESET ROLE; SET ROLE anon");
  await denied(() => save(fresh()));
  await denied(() => db.query("SELECT * FROM public.workspace_chats"));
  console.log(
    `Private chat database: ${assertions} assertions passed (owner isolation, RLS, CAS, archive/restore, shape validation, cloud draft privacy, rate and storage admission).`,
  );
} finally {
  await db.close();
}
