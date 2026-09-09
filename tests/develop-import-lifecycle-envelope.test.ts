import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const body = await readFile(
  new URL("./develop-import-lifecycle.browser.js", import.meta.url),
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// Shadow globals so testing the launch/status envelope cannot reach browser data.
const run = new AsyncFunction(
  "globalThis",
  "crypto",
  "location",
  "sessionStorage",
  "fakeImport",
  body.replaceAll("await import(", "await fakeImport("),
);
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("detached import fixture returns an acknowledgement and captures preflight failure", async () => {
  const isolated: Record<string, unknown> = {};
  const ack = await run(isolated, crypto, {
    origin: "https://invalid.example",
    pathname: "/shoots/eeaf3000-1111-4222-8333-123456789abc/develop",
    search: "",
  });
  expect(ack.started).toBe(true);
  expect(ack.status).toBe("globalThis.fotoImportLifecycle");
  await settle();
  expect(isolated["fotoImportLifecycle"]).toMatchObject({
    state: "failed",
    stage: "failed",
    runId: ack.runId,
    failedStage: "validate-route",
    checks: [],
    result: null,
    cleanup: null,
    cleanupError: null,
  });
  const record = isolated["fotoImportLifecycle"] as { error: string; finishedAt: string };
  expect(record.error).toContain("reserved");
  expect(Number.isFinite(Date.parse(record.finishedAt))).toBe(true);
});

test("detached import fixture rejects overlap without replacing the running status", async () => {
  const record = { state: "running", checks: ["Existing check"], runId: "existing-run" };
  const isolated = { fotoImportLifecycle: record };
  await expect(run(isolated, crypto, {})).rejects.toThrow("already running");
  expect(isolated.fotoImportLifecycle).toBe(record);
  expect(record).toEqual({ state: "running", checks: ["Existing check"], runId: "existing-run" });
});

test("QA status survives loss of the window global with exact run-scoped error evidence", async () => {
  const isolated: Record<string, unknown> = {},
    saved = new Map<string, string>();
  let imports = 0;
  const ack = await run(
    isolated,
    crypto,
    {
      origin: "http://127.0.0.1:8085",
      pathname: "/shoots/eeaf3000-1111-4222-8333-123456789abc/develop",
      search: "",
    },
    {
      setItem(key: string, value: string) {
        saved.set(key, value);
      },
    },
    async () => {
      imports++;
      throw new Error("Synthetic module unavailable");
    },
  );
  await settle();
  expect(imports).toBe(1);
  expect(ack.storageKey).toBe(`foto:qa:import-lifecycle:${ack.runId}`);
  expect(saved.size).toBe(1);
  delete isolated["fotoImportLifecycle"];
  expect(JSON.parse(saved.get(ack.storageKey)!)).toMatchObject({
    state: "failed",
    failedStage: "load-local-modules",
    shoot: "eeaf3000-1111-4222-8333-123456789abc",
    runId: ack.runId,
    error: "Synthetic module unavailable",
    cleanup: null,
    checks: [],
    persistenceError: null,
  });
});

test("unavailable QA session storage is disclosed without replacing the underlying failure", async () => {
  const isolated: Record<string, unknown> = {};
  await run(
    isolated,
    crypto,
    {
      origin: "http://127.0.0.1:8085",
      pathname: "/shoots/eeaf3000-1111-4222-8333-123456789abc/develop",
      search: "",
    },
    {
      setItem() {
        throw new Error("Synthetic session storage full");
      },
    },
    async () => {
      throw new Error("Synthetic module unavailable");
    },
  );
  await settle();
  expect(isolated["fotoImportLifecycle"]).toMatchObject({
    state: "failed",
    error: "Synthetic module unavailable",
    persistenceError: "Synthetic session storage full",
  });
});
