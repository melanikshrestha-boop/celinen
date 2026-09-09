import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { uploadReferenceBatch, type ReferenceUpload } from "../src/lib/reference-upload";

type Dependencies = Parameters<typeof uploadReferenceBatch>[1];
const file = (name = "reference.jpg") => new File([name], name, { type: "image/jpeg" });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const calls: { method: string; path: string }[] = [];
  const recorded = new Set<string>();
  let slots = 0;
  const dependencies: Dependencies = {
    createUrl: async (source) => {
      const path = `authorized/${++slots}/${source.name}`;
      calls.push({ method: "slot", path });
      return { path, signedUrl: `https://upload.invalid/${path}` };
    },
    put: async (url) => {
      calls.push({ method: "put", path: url });
      return { ok: true, status: 200 };
    },
    record: async (path) => {
      calls.push({ method: "record", path });
      recorded.add(path);
      return { ok: true };
    },
    isRecorded: async (path) => {
      calls.push({ method: "check", path });
      return recorded.has(path);
    },
  };
  return { dependencies, calls, recorded };
}

describe("reference upload acknowledgement boundary", () => {
  test.each(["slot", "put", "record", "check"] as const)(
    "an identity change during %s stops later stages and all later files",
    async (stage) => {
      const f = fixture();
      let current = true;
      const dependencies = {
        ...f.dependencies,
        isCurrent: () => current,
        createUrl: async (source: File) => {
          const result = await f.dependencies.createUrl(source);
          if (stage === "slot") current = false;
          return result;
        },
        put: async (url: string, source: File) => {
          const result = await f.dependencies.put(url, source);
          if (stage === "put") current = false;
          return result;
        },
        record: async (path: string, source: File) => {
          const result = await f.dependencies.record(path, source);
          if (stage === "record") current = false;
          return result;
        },
        isRecorded: async () => {
          current = false;
          return true;
        },
      };
      const first: ReferenceUpload =
        stage === "check"
          ? { file: file("a.jpg"), transferredPath: "authorized/a.jpg", confirmationUnknown: true }
          : { file: file("a.jpg") };
      const result = await uploadReferenceBatch([first, { file: file("b.jpg") }], dependencies);
      expect(result.completed).toBe(0);
      expect(result.pending).toHaveLength(2);
      expect(result.error).toContain("destination changed");
      expect(f.calls.some((call) => call.path.includes("b.jpg"))).toBe(false);
      if (stage === "slot") expect(f.calls.map((call) => call.method)).toEqual(["slot"]);
      if (stage === "put") expect(f.calls.map((call) => call.method)).toEqual(["slot", "put"]);
    },
  );
  test.each([
    null,
    {},
    { error: "Slot denied" },
    { signedUrl: "", path: "p" },
    { signedUrl: "url" },
    { signedUrl: "url", path: "p", error: "Denied" },
  ])("invalid/failed slot %j keeps the file without transferring or recording it", async (slot) => {
    const f = fixture(),
      source = file();
    const result = await uploadReferenceBatch([{ file: source }], {
      ...f.dependencies,
      createUrl: async () => slot,
    });
    expect(result.completed).toBe(0);
    expect(result.pending[0]?.file).toBe(source);
    expect(result.error).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });
  test.each([403, 500])(
    "HTTP %i never creates an upload row or reports success",
    async (status) => {
      const f = fixture(),
        source = file();
      const result = await uploadReferenceBatch([{ file: source }], {
        ...f.dependencies,
        put: async () => ({ ok: false, status }),
      });
      expect(result.completed).toBe(0);
      expect(result.pending).toEqual([{ file: source }]);
      expect(result.error).toContain(String(status));
      expect(f.calls.some((call) => call.method === "record")).toBe(false);
    },
  );
  test("thrown transfer errors preserve retry state and never attempt record", async () => {
    const f = fixture(),
      source = file();
    const result = await uploadReferenceBatch([{ file: source }], {
      ...f.dependencies,
      put: async () => {
        throw new Error("Offline");
      },
    });
    expect(result.completed).toBe(0);
    expect(result.pending).toEqual([{ file: source }]);
    expect(result.error).toContain("Offline");
    expect(f.calls.some((call) => call.method === "record")).toBe(false);
  });
  test.each([
    { error: "Record denied" },
    { ok: true, error: "Denied" },
    { ok: true, error: "" },
    { ok: false },
    {},
    null,
  ])("record response %j cannot acknowledge a file", async (response) => {
    const f = fixture(),
      source = file();
    const input = [{ file: source }];
    const result = await uploadReferenceBatch(input, {
      ...f.dependencies,
      record: async () => response,
    });
    expect(result.completed).toBe(0);
    expect(result.pending[0]?.file).toBe(source);
    expect(result.pending[0]?.transferredPath).toBe("authorized/1/reference.jpg");
    expect(result.error).toBeTruthy();
    expect(input).toEqual([{ file: source }]);
  });
  test("explicit recording failure retries the same transferred path without another upload", async () => {
    const f = fixture();
    let attempt = 0;
    const dependencies = {
      ...f.dependencies,
      record: async (path: string, source: File) => {
        if (++attempt === 1) return { error: "Temporary recording error" };
        return f.dependencies.record(path, source);
      },
    };
    const first = await uploadReferenceBatch([{ file: file() }], dependencies);
    expect(first.pending[0]?.confirmationUnknown).toBeUndefined();
    const retry = await uploadReferenceBatch(first.pending, dependencies);
    expect(retry).toEqual({ completed: 1, pending: [], error: null });
    expect(f.calls.filter((call) => call.method === "slot")).toHaveLength(1);
    expect(f.calls.filter((call) => call.method === "put")).toHaveLength(1);
    expect(f.recorded.has(first.pending[0]!.transferredPath!)).toBe(true);
  });
  test("uncertain response after server commit reconciles exact path without resending record", async () => {
    const f = fixture();
    const dependencies = {
      ...f.dependencies,
      record: async (path: string, source: File) => {
        await f.dependencies.record(path, source);
        throw new Error("Response lost after commit");
      },
    };
    const first = await uploadReferenceBatch([{ file: file() }], dependencies);
    expect(first.completed).toBe(0);
    expect(first.pending[0]?.confirmationUnknown).toBe(true);
    const checked = await uploadReferenceBatch(first.pending, dependencies);
    expect(checked).toEqual({ completed: 1, pending: [], error: null });
    expect(f.calls.map((call) => call.method)).toEqual(["slot", "put", "record", "check"]);
  });
  test("missing confirmation never automatically retries an uncertain record even when a lookup is empty", async () => {
    const f = fixture();
    let attempts = 0;
    const dependencies = {
      ...f.dependencies,
      record: async () => {
        attempts++;
        throw new Error("Timed out");
      },
    };
    let result = await uploadReferenceBatch([{ file: file() }], dependencies);
    for (let check = 0; check < 3; check++) {
      result = await uploadReferenceBatch(result.pending, dependencies);
      expect(result.completed).toBe(0);
      expect(result.pending[0]?.confirmationUnknown).toBe(true);
    }
    expect(attempts).toBe(1);
    expect(f.calls.filter((call) => call.method === "put")).toHaveLength(1);
    expect(f.calls.filter((call) => call.method === "check")).toHaveLength(3);
  });
  test("partial success removes only acknowledged files and retries the remaining batch", async () => {
    const f = fixture(),
      sources = [file("a.jpg"), file("b.jpg"), file("c.jpg")];
    let fail = true;
    const dependencies = {
      ...f.dependencies,
      put: async (url: string, source: File) => {
        if (source.name === "b.jpg" && fail) {
          fail = false;
          return { ok: false, status: 503 };
        }
        return f.dependencies.put(url, source);
      },
    };
    const first = await uploadReferenceBatch(
      sources.map((source) => ({ file: source })),
      dependencies,
    );
    expect(first.completed).toBe(1);
    expect(first.pending.map((entry) => entry.file)).toEqual(sources.slice(1));
    const retry = await uploadReferenceBatch(first.pending, dependencies);
    expect(retry).toEqual({ completed: 2, pending: [], error: null });
    expect([...f.recorded].filter((path) => path.endsWith("/a.jpg"))).toHaveLength(1);
    expect(f.recorded.size).toBe(3);
  });
});

/** Execute the actual route handlers, injecting only their UI/server boundary bindings. */
function routeHarness(
  route: "portal" | "guest",
  overrides: Partial<Dependencies> = {},
  listing?: { storage_path: string; url: string | null }[],
) {
  const path = route === "portal" ? "portal.tsx" : "s.$token.tsx";
  const source = readFileSync(new URL(`../src/routes/${path}`, import.meta.url), "utf8");
  const start = source.indexOf("  const uploadFiles = async");
  const end = source.indexOf(
    route === "portal" ? "\n\n  const signOut" : "\n\n  const postNote",
    start,
  );
  if (start < 0 || end < 0)
    throw new Error("Upload route handler boundary changed; update this runtime harness.");
  const f = fixture(),
    dependencies = { ...f.dependencies, ...overrides };
  const state = {
    pending: [] as ReferenceUpload[],
    error: null as string | null,
    uploading: null as string | null,
    refreshes: 0,
  };
  const lock = { current: false },
    generation = { current: 0 },
    fileRef = { current: { value: "chosen-files" } };
  const bindings = {
    uploadLock: lock,
    uploadGeneration: generation,
    fileRef,
    uploadReferenceBatch,
    token: "isolated-shoot-token",
    setPendingUploads: (pending: ReferenceUpload[]) => {
      state.pending = pending;
    },
    setUploadError: (error: string | null) => {
      state.error = error;
    },
    setUploading: (uploading: string | null) => {
      state.uploading = uploading;
    },
    createClientUploadUrl: ({ data }: { data: { filename: string } }) =>
      dependencies.createUrl(file(data.filename)),
    createShootUploadUrl: ({ data }: { data: { token: string; filename: string } }) => {
      expect(data.token).toBe("isolated-shoot-token");
      return dependencies.createUrl(file(data.filename));
    },
    recordClientUpload: ({ data }: { data: { storage_path: string; filename: string } }) =>
      dependencies.record(data.storage_path, file(data.filename)),
    recordShootUpload: ({
      data,
    }: {
      data: { token: string; storage_path: string; filename: string };
    }) => {
      expect(data.token).toBe("isolated-shoot-token");
      return dependencies.record(data.storage_path, file(data.filename));
    },
    listClientUploads: async () =>
      listing ??
      [...f.recorded].map((storage_path) => ({
        storage_path,
        url: "https://download.invalid/photo",
      })),
    getShootSpace: async () => ({
      uploads:
        listing ??
        [...f.recorded].map((storage_path) => ({
          storage_path,
          url: "https://download.invalid/photo",
        })),
    }),
    fetch: (url: string, init: { method: string; body: File }) => {
      expect(init.method).toBe("PUT");
      return dependencies.put(url, init.body);
    },
    refresh: async () => {
      state.refreshes++;
    },
    load: async () => {
      state.refreshes++;
    },
  };
  const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(
    `${source.slice(start, end)}\nreturn { uploadFiles, onFiles };`,
  );
  const handlers = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as {
    uploadFiles: (entries: ReferenceUpload[]) => Promise<void>;
    onFiles: (files: FileList | null) => Promise<void> | undefined;
  };
  return { ...f, handlers, state, lock, generation, fileRef };
}
describe.each(["portal", "guest"] as const)("%s route upload state", (route) => {
  test("a changed destination fences an in-flight transfer and stale UI results", async () => {
    const gate = deferred();
    const h = routeHarness(route, {
      put: async () => {
        await gate.promise;
        return { ok: true, status: 200 };
      },
    });
    const running = h.handlers.uploadFiles([
      { file: file("old.jpg") },
      { file: file("later.jpg") },
    ]);
    await Promise.resolve();
    h.generation.current++;
    h.state.pending = [];
    h.state.error = "New destination";
    h.state.uploading = "New upload";
    h.fileRef.current.value = "new-files";
    gate.resolve();
    await running;
    expect(h.state.pending).toEqual([]);
    expect(h.state.error).toBe("New destination");
    expect(h.state.uploading).toBe("New upload");
    expect(h.fileRef.current.value).toBe("new-files");
    expect(h.state.refreshes).toBe(0);
    expect(
      h.calls.some((call) => call.method === "record" || call.path.includes("later.jpg")),
    ).toBe(false);
  });
  test.each([null, "", "  "])(
    "a matching path without an authorized URL (%j) remains unconfirmed",
    async (url) => {
      const path = "authorized/1/reference.jpg";
      const h = routeHarness(route, {}, [
        { storage_path: path, url },
        { storage_path: "different/path", url: "https://download.invalid/other" },
      ]);
      const source = file();
      await h.handlers.uploadFiles([
        { file: source, transferredPath: path, confirmationUnknown: true },
      ]);
      expect(h.state.pending[0]?.file).toBe(source);
      expect(h.state.pending[0]?.confirmationUnknown).toBe(true);
      expect(h.state.error).toContain("confirmation is still unavailable");
      expect(h.fileRef.current.value).toBe("chosen-files");
      expect(h.state.refreshes).toBe(0);
      expect(h.calls).toHaveLength(0);
    },
  );
  test("an exact path with an authorized URL resolves unknown confirmation without resending", async () => {
    const path = "authorized/1/reference.jpg";
    const h = routeHarness(route, {}, [
      { storage_path: path, url: "https://download.invalid/photo" },
    ]);
    await h.handlers.uploadFiles([
      { file: file(), transferredPath: path, confirmationUnknown: true },
    ]);
    expect(h.state.pending).toEqual([]);
    expect(h.state.error).toBeNull();
    expect(h.fileRef.current.value).toBe("");
    expect(h.state.refreshes).toBe(1);
    expect(h.calls).toHaveLength(0);
  });
  test("failed PUT releases busy state, retains input/file and visible error, and does not refresh a false success", async () => {
    const h = routeHarness(route, { put: async () => ({ ok: false, status: 500 }) });
    const source = file();
    await h.handlers.onFiles([source] as unknown as FileList);
    expect(h.state.error).toContain("500");
    expect(h.state.pending[0]?.file).toBe(source);
    expect(h.state.uploading).toBeNull();
    expect(h.lock.current).toBe(false);
    expect(h.fileRef.current.value).toBe("chosen-files");
    expect(h.state.refreshes).toBe(0);
    expect(h.calls.some((call) => call.method === "record")).toBe(false);
  });
  test("record error cannot clear selection or become uploaded progress", async () => {
    const h = routeHarness(route, { record: async () => ({ error: "Record rejected" }) });
    await h.handlers.uploadFiles([{ file: file() }]);
    expect(h.state.error).toContain("Record rejected");
    expect(h.state.pending[0]?.transferredPath).toBeTruthy();
    expect(h.fileRef.current.value).toBe("chosen-files");
    expect(h.state.refreshes).toBe(0);
  });
  test("acknowledged completion alone clears the input and refreshes the real listing", async () => {
    const h = routeHarness(route);
    await h.handlers.uploadFiles([{ file: file() }]);
    expect(h.state.pending).toEqual([]);
    expect(h.state.error).toBeNull();
    expect(h.state.uploading).toBeNull();
    expect(h.fileRef.current.value).toBe("");
    expect(h.state.refreshes).toBe(1);
  });
  test("a synchronous double submission cannot upload the batch twice", async () => {
    const gate = deferred();
    let transfers = 0;
    const h = routeHarness(route, {
      put: async () => {
        transfers++;
        await gate.promise;
        return { ok: true, status: 200 };
      },
    });
    const entries = [{ file: file() }];
    const first = h.handlers.uploadFiles(entries);
    const second = h.handlers.uploadFiles(entries);
    gate.resolve();
    await Promise.all([first, second]);
    expect(transfers).toBe(1);
    expect(h.calls.filter((call) => call.method === "record")).toHaveLength(1);
  });
});

describe("reference upload identity lifetime wiring", () => {
  test("the guest route remount key follows the exact shoot token", () => {
    const source = readFileSync(new URL("../src/routes/s.$token.tsx", import.meta.url), "utf8");
    const start = source.indexOf("export const Route =");
    const end = source.indexOf("\n\ntype Space", start);
    const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(
      `${source.slice(start, end).replace("export const", "const")}\nreturn Route;`,
    );
    const route = new Function("createFileRoute", "ShootSpace", compiled)(
      () => (options: unknown) => options,
      () => null,
    ) as { remountDeps: (input: { params: { token: string } }) => string };
    expect(route.remountDeps({ params: { token: "shoot-a" } })).toBe("shoot-a");
    expect(route.remountDeps({ params: { token: "shoot-b" } })).toBe("shoot-b");
  });
  test("portal retry state remounts for a different verified account or sign-out", () => {
    const source = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
    const start = source.indexOf("function Portal() {");
    const end = source.indexOf("\n\nfunction AccountPortal", start);
    const compiled = new Bun.Transpiler({
      loader: "tsx",
      tsconfig: { compilerOptions: { jsx: "react" } },
    }).transformSync(`${source.slice(start, end)}\nreturn Portal();`);
    const render = new Function("React", "useAccount", "AccountPortal", compiled);
    const view = (scope: string | null) =>
      render(
        React,
        () => ({ scope }),
        () => null,
      ) as React.ReactElement;
    expect(view("account-a").key).toBe("account-a");
    expect(view("account-b").key).toBe("account-b");
    expect(view(null).key).toBe("signed-out");
  });
  test("the portal auth callback clears only RAM retry state immediately and fences late work", () => {
    const source = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
    const start = source.indexOf("  useEffect(() => {\n    const lifetime = uploadGeneration;");
    const closing = "  }, [accountId]);";
    const end = source.indexOf(closing, start) + closing.length;
    if (start < 0 || end < closing.length)
      throw new Error("Portal auth lifecycle boundary changed");
    const generation = { current: 0 },
      lock = { current: true },
      fileRef = { current: { value: "old-files" } };
    const state: Record<string, unknown> = {
      pending: [{ file: file() }],
      error: "old-error",
      uploading: "old.jpg",
    };
    let receive!: (event: string, session: { user: { id: string } } | null) => void;
    let cleanup!: () => void;
    let unsubscribed = false;
    const bindings = {
      accountId: "account-a",
      uploadGeneration: generation,
      uploadLock: lock,
      fileRef,
      useEffect: (effect: () => () => void) => {
        cleanup = effect();
      },
      supabase: {
        auth: {
          onAuthStateChange: (listener: typeof receive) => {
            receive = listener;
            return {
              data: {
                subscription: {
                  unsubscribe: () => {
                    unsubscribed = true;
                  },
                },
              },
            };
          },
        },
      },
      setPendingUploads: (value: unknown) => {
        state["pending"] = value;
      },
      setUploadError: (value: unknown) => {
        state["error"] = value;
      },
      setUploading: (value: unknown) => {
        state["uploading"] = value;
      },
      setState: (value: unknown) => {
        state["status"] = value;
      },
      setData: (value: unknown) => {
        state["data"] = value;
      },
      setUploads: (value: unknown) => {
        state["uploads"] = value;
      },
      setBookings: (value: unknown) => {
        state["bookings"] = value;
      },
    };
    const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
    new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
    receive("TOKEN_REFRESHED", { user: { id: "account-a" } });
    expect(generation.current).toBe(0);
    expect(state["pending"]).toHaveLength(1);
    receive("SIGNED_IN", { user: { id: "account-b" } });
    expect(generation.current).toBe(1);
    expect(state["pending"]).toEqual([]);
    expect(state["error"]).toBeNull();
    expect(state["uploading"]).toBeNull();
    expect(state["status"]).toBe("anon");
    expect(fileRef.current.value).toBe("");
    expect(lock.current).toBe(false);
    cleanup();
    expect(generation.current).toBe(2);
    expect(unsubscribed).toBe(true);
  });
});
