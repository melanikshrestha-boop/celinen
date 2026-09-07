// Temporary in-memory PostgreSQL. Never reads secrets or contacts production.
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
let checks = 0;
const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const rejects = async (action) => {
  await assert.rejects(action);
  checks++;
};
try {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);",
  );
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0019_commerce_network.sql", import.meta.url),
      "utf8",
    ),
  );
  const owner = crypto.randomUUID(),
    client = crypto.randomUUID(),
    other = crypto.randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1),($2),($3)", [owner, client, other]);
  await db.exec("SET ROLE service_role");
  const saveShop = async (who, state) =>
    (await db.query("SELECT commerce_save_shop($1,$2,$3) AS state", [who, state, state.revision]))
      .rows[0].state;
  const draft = {
    revision: 0,
    name: "Shop",
    domains: [],
    products: [{ id: "one", sourceKey: "one", title: "Print" }],
  };
  const saved = await saveShop(owner, draft);
  eq(saved.revision, 1);
  await rejects(() => saveShop(owner, draft));
  await rejects(() => saveShop(owner, { ...saved, products: [] }));
  await rejects(() =>
    saveShop(owner, { ...saved, products: [{ id: "one", sourceKey: "changed" }] }),
  );
  eq((await saveShop(other, draft)).revision, 1);
  eq(
    (await saveShop(owner, { ...saved, products: [{ ...saved.products[0], archived: true }] }))
      .revision,
    2,
  );
  const profile = {
    displayName: "A Photographer",
    city: "東京",
    country: "日本",
    specialties: ["Sports"],
    languages: "English",
    bio: "Hello",
    visible: false,
    available: true,
  };
  const saveProfile = (who, p, rev) =>
    db.query("SELECT directory_save_profile($1,$2,$3)", [who, p, rev]);
  const discover = async (q = "") =>
    (await db.query("SELECT * FROM directory_discover($1,0)", [q])).rows;
  const send = (sender, id, recipient, message = "Could we shoot a sports event together?") =>
    db.query("SELECT directory_send_inquiry($1,$2,$3,'Requester','collaboration',$4)", [
      sender,
      id,
      recipient,
      message,
    ]);
  await saveProfile(owner, profile, 0);
  eq((await discover()).length, 0);
  await rejects(() => send(client, crypto.randomUUID(), owner));
  await saveProfile(owner, { ...profile, visible: true }, 1);
  eq((await discover("東京")).length, 1);
  eq((await discover("weddings")).length, 0);
  eq((await discover("%")).length, 0);
  eq((await discover())[0].review_count, 0);
  eq((await discover())[0].rating, null);
  await rejects(() => saveProfile(owner, profile, 1));
  const id = crypto.randomUUID();
  await send(client, id, owner);
  await send(client, id, owner);
  eq((await db.query("SELECT count(*) AS n FROM photographer_inquiries")).rows[0].n, 1);
  await rejects(() => send(client, id, owner, "This changed content cannot reuse a request id."));
  await rejects(() => send(other, id, owner));
  await rejects(() => send(client, crypto.randomUUID(), owner));
  await rejects(() => send(owner, crypto.randomUUID(), owner));
  const respond = async (who, status) =>
    (
      await db.query(
        `UPDATE photographer_inquiries SET status=$1 WHERE id=$2 AND ${status === "withdrawn" ? "sender" : "recipient"}=$3 AND status='pending' RETURNING id`,
        [status, id, who],
      )
    ).rows;
  eq((await respond(other, "accepted")).length, 0);
  eq((await respond(client, "accepted")).length, 0);
  eq((await respond(owner, "accepted")).length, 1);
  eq((await respond(client, "withdrawn")).length, 0);
  await saveProfile(owner, { ...profile, visible: true, available: false }, 2);
  await rejects(() => send(other, crypto.randomUUID(), owner));
  await saveProfile(owner, profile, 3);
  eq((await discover()).length, 0);
  eq((await db.query("SELECT count(*) AS n FROM photographer_inquiries")).rows[0].n, 1);
  // Rate limit cannot be bypassed by simultaneous/new request ids; sender lock is transactional.
  await saveProfile(owner, { ...profile, visible: true }, 4);
  await db.query("UPDATE photographer_inquiries SET status='declined'");
  for (let i = 0; i < 19; i++) {
    const rid = crypto.randomUUID();
    await send(client, rid, owner);
    await db.query("UPDATE photographer_inquiries SET status='declined' WHERE id=$1", [rid]);
  }
  await rejects(() => send(client, crypto.randomUUID(), owner));
  await saveProfile(other, { ...profile, displayName: "B Photographer", visible: true }, 0);
  await db.query("INSERT INTO photographer_verified_reviews VALUES($1,$2,$3,5,now())", [
    crypto.randomUUID(),
    owner,
    client,
  ]);
  for (let i = 0; i < 10; i++)
    await db.query("INSERT INTO photographer_verified_reviews VALUES($1,$2,$3,4,now())", [
      crypto.randomUUID(),
      other,
      client,
    ]);
  eq((await discover())[0].owner, other);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    for (const table of [
      "commerce_shops",
      "photographer_directory",
      "photographer_inquiries",
      "photographer_verified_reviews",
    ])
      await rejects(() => db.query(`SELECT * FROM ${table}`));
    await rejects(() => saveShop(owner, draft));
    await rejects(() => saveProfile(owner, profile, 5));
    await rejects(() => send(client, crypto.randomUUID(), owner));
    await rejects(() => discover());
  }
  console.log(
    `Commerce SQL: ${checks} checks passed (owner separation, conflict protection, opt-in visibility, inquiry idempotency, rate limits, review ranking, denied direct access).`,
  );
} finally {
  await db.close();
}
