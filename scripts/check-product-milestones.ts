/** Isolated IndexedDB producer tests; never opens a user's browser/database.
 * bun scripts/check-product-milestones.ts /path/to/fake-indexeddb/build/esm/index.js
 * Tested with fake-indexeddb 6.2.5 installed separately (no runtime dependency). */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createProductAnalytics } from "../src/lib/product-analytics";
import {
  connectProductAnalytics,
  disconnectProductAnalytics,
  recordShootCreation,
} from "../src/lib/product-lifecycle";
import {
  renameShoot,
  rememberShoot,
  startDeviceRecovery,
  markDeviceRecovery,
} from "../src/lib/studio/shoot-directory";

if (!process.argv[2]) throw new Error("Supply the isolated fake-indexeddb module path");
const { IDBFactory, IDBDatabase } = await import(pathToFileURL(resolve(process.argv[2])).href);
const owner = "12345678-1234-4123-a123-123456789012";
const other = "12345678-1234-4123-a123-123456789013";
const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
let checks = 0;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function setup(enabled = true) {
  disconnectProductAnalytics();
  const database = new IDBFactory();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: database });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const events: any[] = [];
  let allowed = true;
  const connect = (account = owner) =>
    connectProductAnalytics(
      account,
      createProductAnalytics({
        config: {
          enabled: String(enabled),
          host: "https://us.i.posthog.com",
          key: "phc_TESTNOTAREALKEY",
        },
        accountId: account,
        cookie: () => (allowed ? "foto_consent=accepted" : "foto_consent=rejected"),
        fetch: async (_url, init) => {
          events.push(JSON.parse(String(init.body)));
          return { ok: true };
        },
      }),
      () => allowed,
    );
  connect();
  return {
    database,
    events,
    connect,
    revoke: () => {
      allowed = false;
      disconnectProductAnalytics();
    },
  };
}
{
  const h = setup(false);
  await recordShootCreation(owner, ids[0]!);
  assert.deepEqual(await h.database.databases(), []);
  assert.deepEqual(h.events, []);
  checks++;
}
{
  const h = setup();
  await renameShoot(owner, ids[0]!, "PRIVATE CLIENT NAME");
  await tick();
  await rememberShoot(owner, ids[0]!, 10, "PRIVATE filename.jpg");
  await renameShoot(owner, ids[0]!, "Changed private name");
  await Promise.all(Array.from({ length: 8 }, () => recordShootCreation(owner, ids[1]!)));
  await tick();
  assert.equal(h.events.filter((e) => e.event === "shoot_created").length, 2);
  assert.equal(h.events.filter((e) => e.event === "second_shoot_created").length, 1);
  assert.ok(!JSON.stringify(h.events).includes("PRIVATE"));
  checks++;
  await recordShootCreation(owner, ids[2]!);
  await recordShootCreation(owner, ids[0]!); // Simulates recreation after photo-library deletion.
  assert.equal(h.events.filter((e) => e.event === "shoot_created").length, 3);
  assert.equal(h.events.filter((e) => e.event === "second_shoot_created").length, 1);
  checks++;
}
{
  const h = setup();
  await startDeviceRecovery(owner, ids[0]!, "Private recovered library");
  await markDeviceRecovery(owner, ids[0]!);
  await rememberShoot(owner, ids[0]!, 20, "Recovered");
  await tick();
  assert.deepEqual(h.events, []);
  checks++;
}
{
  const h = setup();
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args: any[]) {
    const tx = original.apply(this, args);
    if (this.name.includes("shoot-directory") && args[1] === "readwrite")
      queueMicrotask(() => tx.abort());
    return tx;
  };
  try {
    await assert.rejects(renameShoot(owner, ids[0]!, "Aborted"));
  } finally {
    IDBDatabase.prototype.transaction = original;
  }
  await tick();
  assert.deepEqual(h.events, []);
  await renameShoot(owner, ids[0]!, "Retry");
  await tick();
  assert.equal(h.events.filter((e) => e.event === "shoot_created").length, 1);
  checks++;
}
for (const mode of ["open-switch", "transaction-revoke", "analytics-quota"] as const) {
  const h = setup();
  const original = IDBDatabase.prototype.transaction;
  if (mode !== "open-switch")
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      const tx = original.apply(this, args);
      if (this.name.includes("consented-product") && args[1] === "readwrite") {
        if (mode === "transaction-revoke") queueMicrotask(h.revoke);
        else queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  try {
    const pending = recordShootCreation(owner, ids[0]!);
    if (mode === "open-switch") {
      h.connect(other);
      h.connect(owner);
    }
    await pending;
    await tick();
    assert.deepEqual(h.events, []);
  } finally {
    IDBDatabase.prototype.transaction = original;
  }
  // A failed or fenced analytics transaction must not consume the milestone.
  h.connect(owner);
  if (mode !== "transaction-revoke") {
    await recordShootCreation(owner, ids[0]!);
    assert.equal(h.events.filter((e) => e.event === "shoot_created").length, 1);
  }
  checks++;
}
disconnectProductAnalytics();
console.log(
  `${checks} isolated analytics persistence checks passed; no real browser, account, network or photo files used.`,
);
