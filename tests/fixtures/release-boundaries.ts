/** Synthetic subprocess only: no browser, network, real credentials, or original files. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import * as files from "node:fs/promises";
import { mock, spyOn } from "bun:test";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  assertions++;
};
const rejects = async (run: () => Promise<unknown>, message: RegExp) => {
  await assert.rejects(run, message);
  assertions++;
};
globalThis.fetch = (() => {
  throw new Error("Unexpected network request in isolated regression");
}) as typeof fetch;

async function nativeBoundary() {
  class Child extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    kills: string[] = [];
    kill(signal: string) {
      this.kills.push(signal);
      this.emit("close", null);
      return true;
    }
  }
  const children: Child[] = [];
  const timers: { callback: () => void; delay: number; cleared: boolean }[] = [];
  spyOn(childProcess, "spawn").mockImplementation(((_binary: string, args: string[]) => {
    equal(args.slice(1), ["story", "fit", "0.5", "0.5", "1", "black"]);
    const child = new Child();
    children.push(child);
    return child;
  }) as unknown as typeof childProcess.spawn);
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((timer: (typeof timers)[number]) => {
    timer.cleared = true;
  }) as unknown as typeof clearTimeout;
  const { runNativeSocial } = await import("../../src/server/native-social");
  const { DEFAULT_SOCIAL_FRAME } = await import("../../src/lib/social-frame");
  const cancelled = new AbortController();
  cancelled.abort();
  await rejects(
    () => runNativeSocial("fixture", "source", DEFAULT_SOCIAL_FRAME, cancelled.signal),
    /cancelled/,
  );
  equal(children.length, 0);
  for (const failure of ["abort", "timeout", "oversize", "exit", "spawn"] as const) {
    const controller = new AbortController();
    const pending = runNativeSocial("fixture", "source", DEFAULT_SOCIAL_FRAME, controller.signal);
    const checked = rejects(
      () => pending,
      {
        abort: /cancelled/,
        timeout: /timed out/,
        oversize: /exceeds 8 MB/,
        exit: /rejected/,
        spawn: /could not start/,
      }[failure],
    );
    const child = children.at(-1)!;
    equal(timers.at(-1)!.delay, 30_000);
    if (failure === "abort") controller.abort();
    if (failure === "timeout") timers.at(-1)!.callback();
    if (failure === "oversize") child.stdout.emit("data", Buffer.alloc(8 * 1024 * 1024 + 1));
    if (failure === "exit") child.emit("close", 1);
    if (failure === "spawn") child.emit("error", new Error("private source path"));
    await checked;
    equal(child.kills, ["SIGKILL"]);
    equal(timers.at(-1)!.cleared, true);
    controller.abort();
    child.emit("close", 0);
    equal(child.kills, ["SIGKILL"]);
  }
  // Exercise the real adapter's admission and finally blocks using fake files.
  Object.defineProperty(process, "platform", { value: "darwin" });
  const cleanup: string[] = [];
  let writeFails = false;
  spyOn(files, "mkdtemp").mockImplementation(
    (async () => "/synthetic-only/native-frame") as typeof files.mkdtemp,
  );
  spyOn(files, "open").mockImplementation((async (_path: string, flags: string, mode: number) => {
    equal([flags, mode], ["wx", 0o600]);
    return {
      writeFile: async () => {
        if (writeFails) throw new Error("synthetic disk full");
      },
      close: async () => {
        cleanup.push("close");
      },
    };
  }) as unknown as typeof files.open);
  spyOn(files, "unlink").mockImplementation(async () => {
    cleanup.push("unlink");
  });
  spyOn(files, "rmdir").mockImplementation(async () => {
    cleanup.push("rmdir");
  });
  const { nativePublicationFrame } = await import("../../src/lib/business/native-frame.server");
  const before = children.length;
  const frame = nativePublicationFrame(new Blob(["synthetic source"]), DEFAULT_SOCIAL_FRAME);
  await rejects(() => nativePublicationFrame(new Blob(["second"]), DEFAULT_SOCIAL_FRAME), /busy/);
  for (let i = 0; i < 20 && children.length === before; i++) await Promise.resolve();
  equal(children.length, before + 1);
  const child = children.at(-1)!;
  child.stdout.emit("data", Buffer.from([255, 216, 255, 217]));
  child.emit("close", 0);
  equal((await frame).type, "image/jpeg");
  equal(cleanup, ["close", "unlink", "rmdir"]);
  equal(child.kills, []);
  cleanup.length = 0;
  writeFails = true;
  await rejects(
    () => nativePublicationFrame(new Blob(["source"]), DEFAULT_SOCIAL_FRAME),
    /disk full/,
  );
  equal(cleanup, ["close", "unlink", "rmdir"]);
  cleanup.length = 0;
  // The failed adapter releases admission, so the next call reaches the writer again.
  await rejects(
    () => nativePublicationFrame(new Blob(["source"]), DEFAULT_SOCIAL_FRAME),
    /disk full/,
  );
  equal(cleanup, ["close", "unlink", "rmdir"]);
}

async function lightroomBoundary() {
  const token = "synthetic-bridge-token-at-least-20";
  const workspace = "owner-workspace";
  let authReads = 0,
    syncReads = 0,
    writes = 0,
    failWrite = false,
    failRead = false;
  let stored: Record<string, unknown> | null = null;
  const database = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        maybeSingle: async () => {
          if (table === "lightroom_workspaces") {
            authReads++;
            return { data: filters.token === token ? { workspace } : null, error: null };
          }
          equal(table, "lightroom_sync");
          equal(filters.workspace, workspace);
          syncReads++;
          return { data: stored, error: failRead ? { message: "synthetic read failure" } : null };
        },
        upsert: async (value: Record<string, unknown>, options: unknown) => {
          writes++;
          equal(value.workspace, workspace);
          equal(options, { onConflict: "workspace,direction" });
          if (!failWrite) stored = structuredClone(value);
          return { error: failWrite ? { message: "synthetic write failure" } : null };
        },
      };
      return query;
    },
  };
  mock.module("@tanstack/react-router", () => ({
    createFileRoute: () => (value: unknown) => value,
  }));
  mock.module("../../src/integrations/supabase/client.server", () => ({ supabaseAdmin: database }));
  const { Route } = await import("../../src/routes/api/public/lightroom");
  const handlers = (
    Route as unknown as {
      server: { handlers: Record<string, (value: { request: Request }) => Promise<Response>> };
    }
  ).server.handlers;
  const call = (
    method: string,
    body?: unknown,
    query = "",
    authorization: string | null = token,
  ) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (authorization) headers.set("authorization", `Bearer ${authorization}`);
    return handlers[method]!({
      request: new Request(`https://example.invalid/api/public/lightroom${query}`, {
        method,
        headers,
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
    });
  };
  equal((await call("POST", "{")).status, 400);
  equal([authReads, writes], [0, 0]);
  equal((await call("POST", { frames: [] }, "", null)).status, 401);
  equal((await call("GET", undefined, "?workspace=foreign&matching=relative-path-v1")).status, 401);
  equal([syncReads, writes], [0, 0]);
  equal((await call("GET")).status, 409);
  const frame = { file: "Café.ARW", relativePath: "Card/Café.ARW", verdict: "keep", rating: 5 };
  const payload = {
    workspace,
    direction: "to-lightroom",
    kind: "verdicts-relative-path-v1",
    frames: [frame],
  };
  equal((await call("POST", { ...payload, kind: "verdicts" })).status, 409);
  equal(
    (await call("POST", { ...payload, frames: [{ ...frame, relativePath: "../Café.ARW" }] }))
      .status,
    400,
  );
  equal(writes, 0);
  const posted = await call("POST", payload);
  equal(posted.status, 200);
  const receipt = await posted.json();
  equal([receipt.ok, receipt.received, receipt.workspace], [true, 1, workspace]);
  equal(Number.isFinite(receipt.at), true);
  const read = await call("GET", undefined, "?matching=relative-path-v1");
  equal(read.status, 200);
  const response = await read.json();
  equal(
    [response.workspace, response.direction, response.frames],
    [workspace, "to-lightroom", [frame]],
  );
  const original = structuredClone(stored);
  failWrite = true;
  equal((await call("POST", { ...payload, frames: [{ ...frame, rating: 1 }] })).status, 500);
  equal(stored, original);
  failRead = true;
  equal((await call("GET", undefined, "?matching=relative-path-v1")).status, 500);
  failRead = false;
  stored = { ...stored, kind: "verdicts" };
  equal((await call("GET", undefined, "?matching=relative-path-v1")).status, 409);
  equal(writes, 2);
}

async function profileBoundary() {
  const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const auth = Symbol("required-auth-middleware");
  mock.module("@tanstack/react-start", () => ({
    createServerFn: () => {
      let schema: { parse: (value: unknown) => unknown };
      const builder = {
        middleware: (middleware: unknown[]) => {
          equal(middleware, [auth]);
          return builder;
        },
        inputValidator: (value: typeof schema) => {
          schema = value;
          return builder;
        },
        handler:
          (handler: (input: unknown) => Promise<unknown>) =>
          (input: { data: unknown; context: unknown }) =>
            handler({ ...input, data: schema.parse(input.data) }),
      };
      return builder;
    },
  }));
  mock.module("@tanstack/react-start/server", () => ({
    getRequest: () =>
      new Request("https://example.invalid/profile", {
        headers: { authorization: "Bearer captured-synthetic-token" },
      }),
  }));
  mock.module("../../src/integrations/supabase/auth-middleware", () => ({
    requireSupabaseAuth: auth,
  }));
  process.env["SUPABASE_URL"] = "https://auth.example.invalid";
  process.env["SUPABASE_PUBLISHABLE_KEY"] = "synthetic-public-key";
  const sent: Record<string, unknown>[] = [];
  let replyOwner = owner,
    fail = false;
  globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
    equal(String(url), "https://auth.example.invalid/auth/v1/user");
    equal(options?.method, "PUT");
    equal(new Headers(options?.headers).get("Authorization"), "Bearer captured-synthetic-token");
    const body = JSON.parse(options?.body as string);
    sent.push(body.data);
    return fail
      ? new Response("synthetic private failure", { status: 500 })
      : Response.json({ id: replyOwner });
  }) as typeof fetch;
  const { saveAccountProfile } = await import("../../src/lib/account.functions");
  const { readAccountProfile } = await import("../../src/lib/account-profile");
  const data = {
    expectedOwner: owner,
    name: "José 摄影",
    workspaceName: "Evening Games",
    specialties: ["portrait", "headshot"],
    customSpecialty: "Dance",
    biography: "Private biography",
    avatar: "data:image/jpeg;base64,/9j/AAAA",
  };
  const call = async (input: unknown, userId = owner) =>
    (saveAccountProfile as unknown as (value: unknown) => Promise<Record<string, unknown>>)({
      data: input,
      context: { userId },
    });
  const metadata = await call(data);
  equal(metadata, sent.at(-1));
  equal(readAccountProfile(metadata), {
    workspaceName: data.workspaceName,
    setupComplete: true,
    specialties: data.specialties,
    customSpecialty: data.customSpecialty,
    biography: data.biography,
    avatar: data.avatar,
  });
  equal(
    Object.keys(metadata).sort(),
    [
      "display_name",
      "full_name",
      "lenslabs_workspace_name",
      "lenslabs_setup_version",
      "lenslabs_specialties",
      "lenslabs_custom_specialty",
      "lenslabs_biography",
      "lenslabs_avatar",
    ].sort(),
  );
  await call({ expectedOwner: owner, name: "Name only", workspaceName: data.workspaceName });
  equal(
    Object.keys(sent.at(-1)!).sort(),
    ["display_name", "full_name", "lenslabs_workspace_name", "lenslabs_setup_version"].sort(),
  );
  await call({ ...data, specialties: [], customSpecialty: "", biography: "", avatar: "" });
  equal(readAccountProfile(sent.at(-1)), {
    workspaceName: data.workspaceName,
    setupComplete: true,
    specialties: [],
    customSpecialty: "",
    biography: "",
    avatar: "",
  });
  const before = sent.length;
  await rejects(() => call(data, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), /account changed/);
  await rejects(() => call({ ...data, role: "admin" }), /Unrecognized key/);
  equal(sent.length, before);
  replyOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await rejects(() => call(data), /did not match/);
  replyOwner = owner;
  fail = true;
  await rejects(() => call(data), /could not be saved/);
  fail = false;
  equal(await call(data), metadata);
}

const boundary = process.argv[2];
if (boundary === "native") await nativeBoundary();
else if (boundary === "lightroom") await lightroomBoundary();
else if (boundary === "profile") await profileBoundary();
else throw new Error("Choose native, lightroom, or profile in the isolated test runner.");
console.log(`PASS ${boundary}: ${assertions} assertions`);
