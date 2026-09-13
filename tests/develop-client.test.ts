import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { developEngineStatus, renderDevelop } from "../src/lib/develop/client";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
const source = new Blob(["original photo"], { type: "image/jpeg" });
let statusCalls = 0;
let reportedMaxEdge = 4096;
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
    maxEdge: reportedMaxEdge,
    ...(reportedMaxEdge > 4096 ? { maxOutputPixels: 36_000_000, defaultExportEdge: 4096 } : {}),
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

// Observe the production timer requests without making a clock-speed assertion
// about a loaded test machine. Native/HTTP timing is measured separately.
async function withImmediateRetryClock(
  run: (waits: number[]) => Promise<void>,
  afterTimerFires?: () => void,
) {
  const originalSetTimeout = globalThis.setTimeout;
  const waits: number[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    waits.push(Number(delay));
    const timer = originalSetTimeout(() => {
      callback();
      afterTimerFires?.();
    }, 0);
    timers.push(timer);
    return timer;
  }) as typeof setTimeout;
  try {
    await run(waits);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    for (const timer of timers) clearTimeout(timer);
  }
}

beforeEach(async () => {
  statusCalls = 0;
  reportedMaxEdge = 4096;
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

describe("Develop engine status cache", () => {
  test("a failed status is not reused as a five-second ready cache", async () => {
    statusCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (input === "/__develop/status") {
        statusCalls++;
        return Response.json({ error: "down" }, { status: 503 });
      }
      throw new Error("Unexpected test request");
    }) as typeof fetch;
    expect(await developEngineStatus(true)).toBe(null);
    expect(statusCalls).toBe(1);
    expect(await developEngineStatus()).toBe(null);
    expect(statusCalls).toBe(2);
  });
});

describe("Develop high-resolution capability gate", () => {
  test("old engine capability fails clearly before sending a larger source request", async () => {
    await expect(renderDevelop(source, undefined, { edge: 8192 })).rejects.toThrow(
      "larger export size",
    );
    expect(renderCalls).toHaveLength(0);
    const status = await developEngineStatus();
    expect(status?.maxEdge).toBe(4096);
    expect(status?.maxOutputPixels).toBeUndefined();
  });
  test("new engine capability preserves the opt-in edge in the immutable packet", async () => {
    reportedMaxEdge = 8192;
    const status = await developEngineStatus(true);
    expect(status).toMatchObject({
      maxEdge: 8192,
      maxOutputPixels: 36_000_000,
      defaultExportEdge: 4096,
    });
    await renderDevelop(source, undefined, { edge: 8192 });
    expect(renderCalls).toHaveLength(1);
    expect((await decodedRequest(renderCalls[0]!.body as Blob)).header.edge).toBe(8192);
    expect((await decodedRequest(renderCalls[0]!.body as Blob)).source).toBe("original photo");
  });
});

describe("Hosted Develop queued recipe ownership", () => {
  test.each(["supported exposure", "unsupported curve"])(
    "a queued render keeps its admitted recipe after a caller changes %s",
    async (change) => {
      const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
      Object.defineProperty(globalThis, "window", {
        value: { location: { hostname: "lenslab.dev" } },
        configurable: true,
      });
      let decodeCalls = 0;
      const release: (() => void)[] = [];
      let bothActive!: () => void;
      const active = new Promise<void>((resolve) => {
        bothActive = resolve;
      });
      Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        value: async () => {
          decodeCalls++;
          if (decodeCalls <= 2) {
            await new Promise<void>((resolve) => {
              release.push(resolve);
              if (release.length === 2) bothActive();
            });
          }
          return { width: 1, height: 1, close: () => {} };
        },
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          createElement: () => {
            const pixels = new Uint8ClampedArray([128, 128, 128, 255]);
            return {
              width: 1,
              height: 1,
              getContext: () => ({
                drawImage: () => {},
                getImageData: () => ({ data: pixels }),
                putImageData: () => {},
              }),
              toBlob: (done: (blob: Blob) => void) =>
                done(new Blob([pixels], { type: "image/jpeg" })),
            };
          },
        },
      });
      const pending: Promise<Blob>[] = [];
      try {
        // Hold both admitted raster lanes in decoding so the third recipe must wait.
        pending.push(renderDevelop(source), renderDevelop(source));
        await active;
        const settings = defaultDevelopSettings();
        pending.push(renderDevelop(source, settings));
        if (change === "supported exposure") settings.exposure = 1;
        else settings.curve[0]!.y = 0.5;
        const callerRecipe = JSON.stringify(settings);
        expect(decodeCalls).toBe(2);
        for (const finish of release) finish();
        const results = await Promise.all(pending);
        expect(new Uint8Array(await results[2]!.arrayBuffer())).toEqual(
          Uint8Array.of(128, 128, 128, 255),
        );
        expect(JSON.stringify(settings)).toBe(callerRecipe);
        expect(decodeCalls).toBe(3);
        expect(renderCalls).toHaveLength(0);
      } finally {
        for (const finish of release) finish();
        await Promise.allSettled(pending);
        if (previousBitmap) Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
        else Reflect.deleteProperty(globalThis, "createImageBitmap");
        if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
        else Reflect.deleteProperty(globalThis, "document");
      }
    },
  );
});

describe("Develop busy-worker retry", () => {
  test("a newly available worker is retried after 100ms instead of an unconditional half-second", async () => {
    await withImmediateRetryClock(async (waits) => {
      respond = (_, count) => (count === 1 ? errorResponse(429) : imageResponse());
      expect(new Uint8Array(await (await renderDevelop(source)).arrayBuffer())).toEqual(jpeg);
      expect(waits).toEqual([100]);
      expect(renderCalls).toHaveLength(2);
      expect(renderCalls[1]!.body).toBe(renderCalls[0]!.body);
      expect(statusCalls).toBe(1);
    });
  });

  test("gradual waits retain eight retries and exactly four seconds of scheduled backoff", async () => {
    await withImmediateRetryClock(async (waits) => {
      respond = () => errorResponse(429);
      await expect(renderDevelop(source)).rejects.toThrow("429");
      expect(waits).toEqual([100, 200, 300, 400, 600, 700, 800, 900]);
      expect(waits.reduce((sum, delay) => sum + delay, 0)).toBe(4000);
      expect(renderCalls).toHaveLength(9);
      expect(statusCalls).toBe(1);
    });
  });

  test("one token renewal at every busy boundary preserves the same remaining schedule", async () => {
    for (let renewalAt = 1; renewalAt <= 9; renewalAt++) {
      renderCalls = [];
      statusCalls = 0;
      await developEngineStatus(true);
      await withImmediateRetryClock(async (waits) => {
        respond = (_, count) => errorResponse(count === renewalAt ? 403 : 429);
        await expect(renderDevelop(source)).rejects.toThrow("429");
        expect(waits).toEqual([100, 200, 300, 400, 600, 700, 800, 900]);
        expect(renderCalls).toHaveLength(10);
        expect(statusCalls).toBe(2);
        for (const request of renderCalls) expect(request.body).toBe(renderCalls[0]!.body);
      });
    }
  });

  test("cancellation after the fast timer fires but before its continuation never posts again", async () => {
    const controller = new AbortController();
    await withImmediateRetryClock(
      async (waits) => {
        respond = () => errorResponse(429);
        await expect(
          renderDevelop(source, undefined, { signal: controller.signal }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(waits).toEqual([100]);
        expect(renderCalls).toHaveLength(1);
      },
      () => controller.abort(),
    );
  });

  test("overlapping photos own independent waits and cancelling one never shortens the other's budget", async () => {
    const controller = new AbortController();
    const attempts = new Map<BodyInit | null | undefined, number>();
    await withImmediateRetryClock(
      async (waits) => {
        respond = (init) => {
          attempts.set(init.body, (attempts.get(init.body) ?? 0) + 1);
          return errorResponse(429);
        };
        const old = renderDevelop(source, undefined, { signal: controller.signal }).catch(
          (error: unknown) => error,
        );
        const next = renderDevelop(new Blob(["next photo"])).catch((error: unknown) => error);
        expect(await old).toMatchObject({ name: "AbortError" });
        expect(await next).toMatchObject({ message: "Native test error 429" });
        expect([...attempts.values()]).toEqual([1, 9]);
        expect(waits).toEqual([100, 100, 200, 300, 400, 600, 700, 800, 900]);
        expect(statusCalls).toBe(1);
        expect(renderCalls[0]!.signal).toBe(controller.signal);
        expect(renderCalls.slice(1).every((request) => !request.signal)).toBe(true);
      },
      () => controller.abort(),
    );
  });

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

test.skipIf(
  process.platform !== "darwin" ||
    !process.env["LENSLABS_RAW_FIXTURES"] ||
    !existsSync("native/build/lenslabs-develop"),
)(
  "real Node/native cancellation releases its lane before the unchanged next-photo pixels return",
  async () => {
    const child = Bun.spawn(
      [
        "node",
        "--import",
        "tsx",
        fileURLToPath(new URL("./develop-retry-handoff.fixture.ts", import.meta.url)),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const watchdog = setTimeout(() => child.kill("SIGTERM"), 22000);
    try {
      const [output, errors, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(errors).toBe("");
      expect(code).toBe(0);
      const results = JSON.parse(output.trim().replace(/^FOTO_RETRY_HANDOFF /, "")) as Array<{
        statuses: number[];
        serverCloseAfterCancelMs: number;
        handlerSettledAfterCancelMs: number;
      }>;
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.statuses[0]).toBe(429);
        expect(result.statuses.at(-1)).toBe(200);
        expect(result.serverCloseAfterCancelMs).toBeGreaterThanOrEqual(0);
        expect(result.handlerSettledAfterCancelMs).toBeGreaterThanOrEqual(
          result.serverCloseAfterCancelMs,
        );
      }
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
  },
  30000,
);
