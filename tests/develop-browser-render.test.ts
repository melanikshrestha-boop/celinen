import { describe, expect, test } from "bun:test";
import { applyDevelopRgba } from "../src/lib/develop/browser-render";
import { browserDevelopEngineStatus, developEngineStatus } from "../src/lib/develop/client";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

describe("hosted Develop engine", () => {
  test("lenslab.dev uses the browser engine instead of the C++ loopback", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      value: { location: { hostname: "lenslab.dev" } },
      configurable: true,
    });
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchCalls.push(String(input));
      throw new Error("Hosted Develop must not call /__develop/status");
    }) as typeof fetch;
    try {
      const status = await developEngineStatus(true);
      expect(status).toEqual(browserDevelopEngineStatus());
      expect(status?.engine).toBe("foto-develop-browser-1");
      expect(status?.rawSupported).toBe(false);
      expect(fetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});

describe("browser Develop tone", () => {
  test("neutral settings leave pixels unchanged", () => {
    const rgba = new Uint8ClampedArray([200, 180, 40, 255, 10, 10, 10, 255]);
    applyDevelopRgba(rgba, 2, 1, defaultDevelopSettings());
    expect([...rgba]).toEqual([200, 180, 40, 255, 10, 10, 10, 255]);
  });

  test("negative highlights pull a bright noon pixel", () => {
    const rgba = new Uint8ClampedArray([250, 248, 240, 255]);
    const settings = defaultDevelopSettings();
    settings.highlights = -36;
    settings.whites = -17;
    settings.exposure = -0.4;
    applyDevelopRgba(rgba, 1, 1, settings);
    expect(rgba[0]!).toBeLessThan(250);
    expect(rgba[1]!).toBeLessThan(248);
    expect(rgba[2]!).toBeLessThan(240);
  });
});
