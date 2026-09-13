import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

// Execute the actual transport function with an isolated status/fetch boundary.
const source = readFileSync(new URL("../src/lib/studio/native-client.ts", import.meta.url), "utf8");
const from = source.indexOf("export async function nativeStudioRequest(");
const to = source.indexOf("const channel =", from);
if (from < 0 || to < 0) throw new Error("Native transport function boundary missing");
const body = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.slice(from, to).replace("export async function", "async function"),
);
function fixture(fetcher: typeof fetch) {
  let statusReads = 0;
  const request = new Function(
    "nativeEngineStatus",
    "NATIVE_REQUEST_POLICY",
    "fetch",
    "z",
    `let statusPromise = null; ${body}\nreturn nativeStudioRequest;`,
  )(
    async () => ({ ready: true, token: `token-${++statusReads}` }),
    { maxAttempts: 2 },
    fetcher,
    z,
  ) as (path: string, init: RequestInit) => Promise<Response>;
  return {
    request,
    get statusReads() {
      return statusReads;
    },
  };
}
const photo = new File(["synthetic raw bytes"], "reserved.ARW");

describe("native upload admission", () => {
  test("no original body transfers until the small admission request is acknowledged", async () => {
    let release!: (response: Response) => void;
    const admitted = new Promise<Response>((done) => {
      release = done;
    });
    const calls: { path: string; body: BodyInit | null | undefined; headers: Headers }[] = [];
    const f = fixture((async (path, init) => {
      calls.push({ path: String(path), body: init?.body, headers: new Headers(init?.headers) });
      return String(path) === "/__native/admission" ? admitted : new Response("frame");
    }) as typeof fetch);
    const pending = f.request("/__native/analyze", {
      method: "POST",
      body: photo,
      headers: { "content-length": String(photo.size) },
    });
    await Promise.resolve();
    await Promise.resolve();
    const before = calls.map((call) => ({ path: call.path, original: call.body === photo }));
    release(Response.json({ admission: "a".repeat(48) }));
    await pending;
    expect(before).toEqual([{ path: "/__native/admission", original: false }]);
    expect(calls.map((call) => call.path)).toEqual(["/__native/admission", "/__native/analyze"]);
    expect(calls[1]?.body).toBe(photo);
    expect(calls[0]?.headers.has("content-length")).toBe(false);
    expect(calls[1]?.headers.get("x-lenslabs-admission")).toBe("a".repeat(48));
  });

  test("cancelling after admission never starts an original upload", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const f = fixture((async (path) => {
      calls.push(String(path));
      controller.abort();
      return Response.json({ admission: "a".repeat(48) });
    }) as typeof fetch);
    await expect(
      f.request("/__native/analyze", {
        method: "POST",
        body: photo,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual(["/__native/admission"]);
  });

  test("an admission token refresh happens before upload, and a busy upload is never resent", async () => {
    const calls: string[] = [];
    const f = fixture((async (path) => {
      calls.push(String(path));
      if (calls.length === 1) return Response.json({ error: "Expired session" }, { status: 403 });
      if (String(path) === "/__native/admission")
        return Response.json({ admission: "b".repeat(48) });
      return Response.json({ error: "Busy" }, { status: 429 });
    }) as typeof fetch);
    await expect(f.request("/__native/analyze", { method: "POST", body: photo })).rejects.toThrow(
      "Busy",
    );
    expect(calls).toEqual(["/__native/admission", "/__native/admission", "/__native/analyze"]);
    expect(f.statusReads).toBe(2);
  });

  test("malformed admission or an analysis 403 never triggers a second original transfer", async () => {
    for (const malformed of [true, false]) {
      let uploads = 0;
      const f = fixture((async (path) => {
        if (String(path) === "/__native/admission")
          return Response.json(malformed ? { admission: "" } : { admission: "a".repeat(48) });
        uploads++;
        return Response.json({ error: "Expired" }, { status: 403 });
      }) as typeof fetch);
      await expect(
        f.request("/__native/analyze", { method: "POST", body: photo }),
      ).rejects.toThrow();
      expect(uploads).toBe(malformed ? 0 : 1);
    }
  });
});
