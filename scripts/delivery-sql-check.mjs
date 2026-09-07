// Isolated Postgres-compatible migration checks. Never connects to a hosted database.
// node scripts/delivery-sql-check.mjs /absolute/temp/runtime-with-pglite
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
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};
const rpc = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const owner = crypto.randomUUID(),
  other = crypto.randomUUID(),
  third = crypto.randomUUID();
const gallery = crypto.randomUUID(),
  version = crypto.randomUUID(),
  fingerprint = "a".repeat(64);
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0014_proof_to_final_delivery.sql", import.meta.url),
      "utf8",
    ),
  );
  const legacyOwner = crypto.randomUUID(),
    legacyRoom = crypto.randomUUID(),
    legacyVersion = crypto.randomUUID();
  const legacyMedia = { bytes: 1000, sha256: fingerprint, width: 10, height: 10 };
  const legacyState = {
    format: 1,
    status: "draft",
    photos: [
      {
        versions: [
          {
            id: legacyVersion,
            ready: true,
            variants: { proof: legacyMedia, phone: legacyMedia, full: legacyMedia },
          },
          {
            id: crypto.randomUUID(),
            ready: false,
            variants: { proof: legacyMedia, phone: legacyMedia, full: legacyMedia },
          },
        ],
      },
    ],
  };
  await db.query("INSERT INTO auth.users VALUES ($1)", [legacyOwner]);
  await db.query("INSERT INTO public.delivery_rooms(id,owner_id,state) VALUES ($1,$2,$3)", [
    legacyRoom,
    legacyOwner,
    JSON.stringify(legacyState),
  ]);
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0015_delivery_launch_guards.sql", import.meta.url),
      "utf8",
    ),
  );
  check(
    await rpc(
      "SELECT reserved_bytes AS result FROM public.delivery_owner_limits WHERE owner_id=$1",
      [legacyOwner],
    ),
    94374840,
    "legacy pending and ready objects backfilled",
  );
  check(
    await rpc("SELECT enabled AS result FROM public.delivery_owner_limits WHERE owner_id=$1", [
      legacyOwner,
    ]),
    false,
    "existing owner needs explicit pilot approval",
  );
  check(
    await rpc("SELECT public.delivery_settle_upload($1,$2,$3,3000) AS result", [
      legacyOwner,
      legacyRoom,
      legacyVersion,
    ]),
    true,
    "old ready version can reconcile after a lost response",
  );
  await db.query("INSERT INTO auth.users VALUES ($1), ($2), ($3)", [owner, other, third]);
  const state = {
    format: 1,
    status: "live",
    photos: [{ versions: [{ id: version, ready: false }] }],
    events: [],
  };
  await db.query(
    "INSERT INTO public.delivery_rooms(id, owner_id, state, invitation_hash) VALUES ($1, $2, $3, $4)",
    [gallery, owner, JSON.stringify(state), fingerprint],
  );
  const reserve = (v = version, hash = fingerprint) =>
    rpc("SELECT public.delivery_reserve_upload($1,$2,$3,$4) AS result", [owner, gallery, v, hash]);
  check(await reserve(), false, "unapproved owner refused");
  await db.query(
    "INSERT INTO public.delivery_owner_limits(owner_id, byte_limit) VALUES ($1, 94371840)",
    [owner],
  );
  check(await reserve(), true, "first ceiling-sized reservation");
  check(await reserve(), true, "retry does not charge twice");
  check(await reserve(version, "b".repeat(64)), false, "changed immutable reservation refused");
  check(await reserve(crypto.randomUUID()), false, "pending byte ceiling enforced");
  check(
    await rpc(
      "SELECT reserved_bytes AS result FROM public.delivery_owner_limits WHERE owner_id=$1",
      [owner],
    ),
    94371840,
    "budget unchanged by retries",
  );
  check(
    await rpc("SELECT public.delivery_settle_upload($1,$2,$3,1000) AS result", [
      owner,
      gallery,
      version,
    ]),
    false,
    "unverified bytes cannot settle",
  );
  await db.query(
    "UPDATE public.delivery_rooms SET state=jsonb_set(state,'{photos,0,versions,0,ready}','true') WHERE id=$1",
    [gallery],
  );
  check(
    await rpc("SELECT public.delivery_settle_upload($1,$2,$3,1000) AS result", [
      owner,
      gallery,
      version,
    ]),
    true,
    "verified bytes settle",
  );
  check(
    await rpc("SELECT public.delivery_settle_upload($1,$2,$3,1000) AS result", [
      owner,
      gallery,
      version,
    ]),
    true,
    "settlement idempotent",
  );
  check(
    await rpc(
      "SELECT reserved_bytes AS result FROM public.delivery_owner_limits WHERE owner_id=$1",
      [owner],
    ),
    1000,
    "actual charge once",
  );
  check(
    await rpc("SELECT public.delivery_settle_upload($1,$2,$3,10) AS result", [
      owner,
      gallery,
      version,
    ]),
    false,
    "cannot alter settled charge",
  );
  const token = crypto.randomUUID(),
    token2 = crypto.randomUUID(),
    token3 = crypto.randomUUID();
  const acquire = (o, t) =>
    rpc("SELECT public.delivery_acquire_verification($1,$2) AS result", [o, t]);
  check(await acquire(owner, token), true, "first verification lease");
  check(await acquire(owner, token2), false, "one active lease per owner");
  check(await acquire(other, token2), true, "second global slot");
  check(await acquire(third, token3), false, "global concurrency limit");
  await db.query("SELECT public.delivery_release_verification($1,$2)", [owner, token2]);
  check(await acquire(third, token3), false, "wrong token cannot release");
  await db.query(
    "UPDATE public.delivery_verification_slots SET expires_at=now()-interval '1 second' WHERE owner_id=$1",
    [owner],
  );
  check(await acquire(owner, token3), true, "expired slot can be reacquired");
  await db.query("SELECT public.delivery_release_verification($1,$2)", [owner, token]);
  check(await acquire(third, crypto.randomUUID()), false, "late release cannot clear newer lease");
  await assert.rejects(
    db.query("SELECT * FROM public.delivery_commit_verified($1,$2,0,$3,$4)", [
      owner,
      gallery,
      JSON.stringify(state),
      token,
    ]),
    /lease expired/,
  );
  assertions++;
  check(
    (
      await db.query("SELECT * FROM public.delivery_commit_verified($1,$2,999,$3,$4)", [
        owner,
        gallery,
        JSON.stringify(state),
        token3,
      ])
    ).rows.length,
    0,
    "stale revision cannot commit",
  );
  const events = Array.from({ length: 20000 }, (_, i) => ({ id: i, text: "existing history" }));
  await db.query(
    "UPDATE public.delivery_rooms SET state=jsonb_set(state,'{events}',$2::jsonb) WHERE id=$1",
    [gallery, JSON.stringify(events)],
  );
  const op = crypto.randomUUID();
  await db.query("SELECT * FROM public.delivery_close_room($1,$2,0,$3)", [owner, gallery, op]);
  const closed = (
    await db.query(
      "SELECT state, invitation_hash, revision FROM public.delivery_rooms WHERE id=$1",
      [gallery],
    )
  ).rows[0];
  check(closed.state.status, "closed", "full activity log can close");
  check(closed.state.events, events, "history preserved exactly");
  check(closed.invitation_hash, null, "invitation revoked");
  await db.query("SELECT * FROM public.delivery_close_room($1,$2,0,$3)", [owner, gallery, op]);
  check(
    await rpc("SELECT revision AS result FROM public.delivery_rooms WHERE id=$1", [gallery]),
    1,
    "lost closure response replay",
  );
  check(
    await rpc("SELECT count(*)::int AS result FROM public.delivery_safety_events"),
    1,
    "one separate safety audit",
  );
  for (const role of ["anon", "authenticated"]) {
    for (const table of [
      "delivery_rooms",
      "delivery_owner_limits",
      "delivery_upload_budget",
      "delivery_verification_slots",
      "delivery_safety_events",
    ])
      check(
        await rpc("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS result", [
          role,
          `public.${table}`,
        ]),
        false,
        `${role} cannot access ${table}`,
      );
    for (const fn of [
      "delivery_close_room(uuid,uuid,integer,uuid)",
      "delivery_reserve_upload(uuid,uuid,uuid,text)",
      "delivery_settle_upload(uuid,uuid,uuid,bigint)",
      "delivery_acquire_verification(uuid,uuid)",
      "delivery_release_verification(uuid,uuid)",
      "delivery_commit_verified(uuid,uuid,integer,jsonb,uuid)",
    ])
      check(
        await rpc("SELECT has_function_privilege($1,$2,'EXECUTE') AS result", [
          role,
          `public.${fn}`,
        ]),
        false,
        `${role} cannot execute ${fn}`,
      );
  }
  console.log(
    `Delivery migration QA: ${assertions} assertions passed in isolated Postgres (PGlite). No hosted data accessed.`,
  );
} finally {
  await db.close();
}
