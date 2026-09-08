import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { developEngineStatus, renderDevelop } from "../src/lib/develop/client";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
const source = new Blob(["original photo"], { type: "image/jpeg" });
let statusCalls = 0;
let renderCalls: RequestInit[] = [];
let respond: (init: RequestInit, count: number) => Response | Promise<Response>;

function imageResponse(mode: "preview" | "raw" = "preview"): Response {
  return new Response(jpeg, {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(jpeg.length),
      "x-foto-source": mode === "raw" ? "raw-demosaic" : "preview",
    },
  });
}
function errorResponse(status: number): Response {
  return Response.json({ error: `Native test error ${status}` }, { status });
}
function statusResponse(): Response {
  return Response.json({
    ready: true,
    token: `token-${statusCalls}`,
    engine: "test-native-develop",
    maxEdge: 4096,
    maxFileBytes: 128 * 1024 * 1024,
    workingSpace: "sRGB",
    rawSupported: true,
  });
}
async function decodedRequest(
  body: Blob,
): Promise<{ header: Record<string, unknown>; source: string }> {
  const bytes = await body.arrayBuffer();
  const length = new DataView(bytes).getUint32(0, false);
  return {
    header: JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + length))),
    source: new TextDecoder().decode(bytes.slice(4 + length)),
  };
}

beforeEach(async () => {
  statusCalls = 0;
  renderCalls = [];
  respond = () => imageResponse();
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname: "127.0.0.1" } },
    configurable: true,
  });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (input === "/__develop/status") {
      statusCalls++;
      return statusResponse();
    }
    if (input !== "/__develop/render" || !init) throw new Error("Unexpected test request");
    renderCalls.push(init);
    return respond(init, renderCalls.length);
  }) as typeof fetch;
  // Refresh only the capability cache, never leave a previous test's token behind.
  await developEngineStatus(true);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("Develop busy-worker retry", () => {
  test("retries an explicit 429 without refreshing the token or changing the request", async () => {
    respond = (_, count) => (count === 1 ? errorResponse(429) : imageResponse());
    expect(new Uint8Array(await (await renderDevelop(source)).arrayBuffer())).toEqual(jpeg);
    expect(renderCalls).toHaveLength(2);
    expect(renderCalls[1]!.body).toBe(renderCalls[0]!.body);
    expect(statusCalls).toBe(1);
  });

  test("stops after eight busy retries even when the response requests an arbitrary long wait", async () => {
    respond = () => {
      const response = errorResponse(429);
      response.headers.set("retry-after", "999999");
      return response;
    };
    await expect(renderDevelop(source)).rejects.toThrow("Native test error 429");
    expect(renderCalls).toHaveLength(9);
    expect(statusCalls).toBe(1);
  }, 7000);

  test("a 403 refresh does not reset the separate busy retry budget", async () => {
    respond = (_, count) => errorResponse(count === 5 ? 403 : 429);
    await expect(renderDevelop(source)).rejects.toThrow("Native test error 429");
    expect(renderCalls).toHaveLength(10);
    expect(statusCalls).toBe(2);
  }, 7000);

  test("refreshes one expired token even after a busy response", async () => {
    respond = (_, count) =>
      count === 1 ? errorResponse(429) : count === 2 ? errorResponse(403) : imageResponse();
    await renderDevelop(source);
    expect(renderCalls).toHaveLength(3);
    expect(statusCalls).toBe(2);
    expect(new Headers(renderCalls[0]!.headers).get("x-lenslabs-token")).toBe("token-1");
    expect(new Headers(renderCalls[2]!.headers).get("x-lenslabs-token")).toBe("token-2");
  });

  test("never refreshes a second 403", async () => {
    respond = () => errorResponse(403);
    await expect(renderDevelop(source)).rejects.toThrow("403");
    expect(renderCalls).toHaveLength(2);
    expect(statusCalls).toBe(2);
  });

  test("does not retry uncertain network failures or other error statuses", async () => {
    respond = () => Promise.reject(new TypeError("Network failure"));
    await expect(renderDevelop(source)).rejects.toThrow("Network failure");
    expect(renderCalls).toHaveLength(1);
    for (const status of [400, 408, 413, 500, 503]) {
      renderCalls = [];
      respond = () => errorResponse(status);
      await expect(renderDevelop(source)).rejects.toThrow(String(status));
      expect(renderCalls).toHaveLength(1);
    }
  });

  test("an already aborted render never posts a source", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderDevelop(source, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(renderCalls).toHaveLength(0);
  });

  test("aborting the backoff prevents the obsolete photo from retrying while a new photo succeeds", async () => {
    const controller = new AbortController();
    let releaseBusy!: () => void;
    const busyReturned = new Promise<void>((resolve) => {
      releaseBusy = resolve;
    });
    respond = (_, count) => {
      if (count === 1) {
        releaseBusy();
        return errorResponse(429);
      }
      return imageResponse();
    };
    const obsolete = renderDevelop(source, undefined, { signal: controller.signal });
    const outcome = obsolete.then(
      () => null,
      (error: unknown) => error,
    );
    await busyReturned;
    // Let the response enter its scheduled retry before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(await outcome).toMatchObject({ name: "AbortError" });
    const replacement = new Blob(["replacement photo"]);
    await renderDevelop(replacement);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(renderCalls).toHaveLength(2);
    expect((await decodedRequest(renderCalls[1]!.body as Blob)).source).toBe("replacement photo");
  });

  test("snapshots settings and source mode for every retry instead of reading mutated caller options", async () => {
    const settings = defaultDevelopSettings();
    const options: { edge: number; quality: number; sourceMode: "raw" | "preview" } = {
      edge: 1600,
      quality: 0.9,
      sourceMode: "raw",
    };
    respond = (_, count) => {
      if (count === 1) {
        settings.exposure = 3;
        options.edge = 4096;
        options.quality = 0.5;
        options.sourceMode = "preview";
        return errorResponse(429);
      }
      return imageResponse("raw");
    };
    await renderDevelop(source, settings, options);
    expect(renderCalls).toHaveLength(2);
    expect(renderCalls[1]!.body).toBe(renderCalls[0]!.body);
    const request = await decodedRequest(renderCalls[1]!.body as Blob);
    expect(request.source).toBe("original photo");
    expect(request.header).toMatchObject({
      edge: 1600,
      quality: 0.9,
      sourceMode: "raw",
      settings: { exposure: 0 },
    });
  });

  test("checks cancellation after a pending capability fetch before posting source bytes", async () => {
    let releaseStatus!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const normalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (input === "/__develop/status") await pending;
      return normalFetch(input, init);
    }) as typeof fetch;
    const refreshing = developEngineStatus(true);
    const controller = new AbortController();
    const rendering = renderDevelop(source, undefined, { signal: controller.signal });
    const outcome = rendering.then(
      () => null,
      (error: unknown) => error,
    );
    controller.abort();
    releaseStatus();
    await refreshing;
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(renderCalls).toHaveLength(0);
  });

  test("does not return stale pixels when cancellation races with a completed response", async () => {
    const controller = new AbortController();
    respond = () => {
      controller.abort();
      return imageResponse();
    };
    await expect(
      renderDevelop(source, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(renderCalls).toHaveLength(1);
  });

  test("still rejects a source-mode receipt mismatch after a busy retry", async () => {
    respond = (_, count) => (count === 1 ? errorResponse(429) : imageResponse("preview"));
    await expect(renderDevelop(source, undefined, { sourceMode: "raw" })).rejects.toThrow(
      "invalid image receipt",
    );
    expect(renderCalls).toHaveLength(2);
  });
});
