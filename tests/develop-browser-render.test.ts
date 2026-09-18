import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DevelopControls } from "../src/components/develop/DevelopControls";
import { applyDevelopRgba, renderDevelopInBrowser } from "../src/lib/develop/browser-render";
import { browserDevelopEngineStatus, developEngineStatus } from "../src/lib/develop/client";
import { defaultDevelopSettings, type DevelopSettings } from "../src/lib/develop/contract";
import { unsupportedBrowserDevelopEdits } from "../src/lib/develop/browser-capabilities";

const unsupportedEdits: [string, (settings: DevelopSettings) => void][] = [
  [
    "Tone curve",
    (s) => {
      s.curve = [
        { x: 0, y: 0 },
        { x: 0.5, y: 1 },
        { x: 1, y: 1 },
      ];
    },
  ],
  ...(["red", "green", "blue"] as const).map((channel): [string, (s: DevelopSettings) => void] => [
    "RGB curves",
    (s) => {
      s.channelCurves[channel][0]!.y = 0.1;
    },
  ]),
  ...(["hue", "saturation", "luminance"] as const).map(
    (field): [string, (s: DevelopSettings) => void] => [
      "Color mixer",
      (s) => {
        s.hsl[0]![field] = 20;
      },
    ],
  ),
  ...(["shadows", "midtones", "highlights", "global"] as const).flatMap((range) =>
    (["saturation", "luminance"] as const).map((field): [string, (s: DevelopSettings) => void] => [
      "Color grading",
      (s) => {
        s.grading[range][field] = 20;
      },
    ]),
  ),
  ...(
    [
      ["texture", "Texture"],
      ["clarity", "Clarity"],
      ["sharpening", "Sharpening"],
      ["noiseReduction", "Noise reduction"],
      ["colorNoiseReduction", "Color noise reduction"],
      ["grain", "Grain"],
      ["fade", "Fade"],
      ["filmFalloff", "Film falloff"],
      ["vignette", "Vignette"],
      ["bloom", "Bloom"],
      ["halation", "Halation"],
    ] as const
  ).map(([field, label]): [string, (s: DevelopSettings) => void] => [
    label,
    (s) => {
      s[field] = 20;
    },
  ]),
  ...(["exposure", "temperature", "saturation"] as const).map(
    (field): [string, (s: DevelopSettings) => void] => [
      "Masks",
      (s) => {
        s.masks = [
          {
            id: "synthetic",
            name: "Synthetic",
            enabled: true,
            type: "radial",
            x: 0.5,
            y: 0.5,
            radius: 0.5,
            aspect: 1,
            angle: 0,
            feather: 0.5,
            invert: false,
            exposure: 0,
            temperature: 0,
            saturation: 0,
            [field]: 1,
          },
        ];
      },
    ],
  ),
  [
    "Straighten",
    (s) => {
      s.crop.angle = 5;
    },
  ],
];

describe("hosted Develop controls", () => {
  const advancedPanels = [
    "Tone Curve",
    "Color Mixer",
    "Color Grading",
    "Effects",
    "Detail",
    "Masking",
  ];
  const control = (html: string, label: string) => {
    const tag = html.match(
      new RegExp(`<(?:input|select|button)\\b[^>]*aria-label="${label}"[^>]*>`),
    )?.[0];
    expect(tag).toBeDefined();
    return tag!;
  };
  const panel = (html: string, title: string) => {
    const markup = html
      .match(/<details\b[\s\S]*?<\/details>/g)
      ?.find((part) => part.includes(`<summary>${title}<`));
    expect(markup).toBeDefined();
    return markup!;
  };
  const renderControls = (browserOnly?: boolean) => {
    const value = defaultDevelopSettings();
    value.curve[0]!.y = 0.2;
    value.grain = 30;
    const before = JSON.stringify(value);
    let writes = 0;
    const html = renderToStaticMarkup(
      createElement(DevelopControls, {
        value,
        browserOnly,
        tool: "edit",
        maskId: null,
        change: () => {
          writes++;
        },
        onTool: () => {},
        onMask: () => {},
      }),
    );
    expect(JSON.stringify(value)).toBe(before);
    expect(writes).toBe(0);
    return html;
  };

  test("browser mode disables unsupported controls while leaving basic tone and crop available", () => {
    const html = renderControls(true);
    for (const label of ["Texture", "Clarity", "Straighten"])
      expect(control(html, label)).toContain('disabled=""');
    for (const title of advancedPanels)
      expect(panel(html, title)).toContain('<fieldset disabled="">');
    for (const label of [
      "Exposure",
      "Temp",
      "Dehaze",
      "Profile",
      "White balance",
      "Color",
      "Black and White",
      "Crop aspect",
      "Crop width",
      "Rotate clockwise",
      "Flip horizontal",
    ])
      expect(control(html, label)).not.toContain('disabled=""');
    expect(panel(html, "Basic")).not.toContain('<fieldset disabled="">');
    expect(panel(html, "Crop &amp; Straighten")).not.toContain('<fieldset disabled="">');
  });

  test("default and explicit native modes retain the advanced controls without recipe changes", () => {
    for (const browserOnly of [undefined, false]) {
      const html = renderControls(browserOnly);
      for (const title of advancedPanels)
        expect(panel(html, title)).not.toContain('<fieldset disabled="">');
      for (const label of [
        "Texture",
        "Clarity",
        "Straighten",
        "Grain",
        "Sharpening",
        "Exposure",
        "Crop width",
      ])
        expect(control(html, label)).not.toContain('disabled=""');
    }
  });
});

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
  test.each(unsupportedEdits)(
    "rejects active %s without changing pixels or the recipe",
    (name, edit) => {
      const settings = defaultDevelopSettings();
      settings.exposure = 1;
      edit(settings);
      const savedRecipe = JSON.stringify(settings);
      const rgba = new Uint8ClampedArray([128, 128, 128, 255]);
      expect(() => applyDevelopRgba(rgba, 1, 1, settings)).toThrow(name);
      expect([...rgba]).toEqual([128, 128, 128, 255]);
      expect(JSON.stringify(settings)).toBe(savedRecipe);
    },
  );

  test("rejects unsupported export recipes before opening the source", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    let decodeCalls = 0;
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: async () => {
        decodeCalls++;
        throw new Error("Source decoding was reached");
      },
    });
    try {
      for (const [name, edit] of unsupportedEdits) {
        const settings = defaultDevelopSettings();
        edit(settings);
        await expect(renderDevelopInBrowser(new Blob(["synthetic"]), settings)).rejects.toThrow(
          name,
        );
      }
      expect(decodeCalls).toBe(0);
    } finally {
      if (previous) Object.defineProperty(globalThis, "createImageBitmap", previous);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  });

  test("inactive secondary settings and disabled masks preserve the supported path", () => {
    const settings = defaultDevelopSettings();
    settings.curveInterpolation = "smooth";
    settings.grainSize = 4;
    settings.grainLuminance = 100;
    settings.sharpeningRadius = 3;
    settings.sharpeningDetail = 0;
    settings.sharpeningMasking = 100;
    settings.grading.balance = -100;
    settings.grading.blending = 100;
    for (const range of ["shadows", "midtones", "highlights", "global"] as const)
      settings.grading[range].hue = 180;
    settings.masks = [
      {
        id: "disabled",
        name: "Disabled edit",
        enabled: false,
        type: "radial",
        x: 0.5,
        y: 0.5,
        radius: 0.5,
        aspect: 1,
        angle: 0,
        feather: 0.5,
        invert: false,
        exposure: 5,
        temperature: 100,
        saturation: 100,
      },
    ];
    settings.masks.push({
      ...settings.masks[0]!,
      id: "zero",
      enabled: true,
      exposure: 0,
      temperature: 0,
      saturation: 0,
    });
    const savedRecipe = JSON.stringify(settings);
    for (const model of ["legacy", "tonal"] as const) {
      settings.grading.model = model;
      expect(unsupportedBrowserDevelopEdits(settings)).toEqual([]);
      const rgba = new Uint8ClampedArray([128, 128, 128, 255]);
      applyDevelopRgba(rgba, 1, 1, settings);
      expect([...rgba]).toEqual([128, 128, 128, 255]);
    }
    expect(JSON.stringify(settings)).toBe(savedRecipe);
  });

  test("direct color transforms reject geometry that only the complete renderer applies", () => {
    for (const edit of [
      { x: 0.1, width: 0.9 },
      { y: 0.1, height: 0.9 },
      { width: 0.5 },
      { height: 0.5 },
      { rotate: 90 as const },
      { flipX: true },
      { flipY: true },
    ]) {
      const settings = defaultDevelopSettings();
      settings.crop = { ...settings.crop, ...edit };
      expect(unsupportedBrowserDevelopEdits(settings)).toEqual([]);
      const rgba = new Uint8ClampedArray([128, 128, 128, 255]);
      expect(() => applyDevelopRgba(rgba, 1, 1, settings)).toThrow("full browser renderer");
      expect([...rgba]).toEqual([128, 128, 128, 255]);
    }
  });

  test("supported crop, rotate and flip still reach the complete renderer", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    let decodeCalls = 0;
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: async () => {
        decodeCalls++;
        throw new Error("Synthetic decode boundary");
      },
    });
    try {
      const settings = defaultDevelopSettings();
      settings.crop = {
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
        rotate: 90,
        angle: 0,
        flipX: true,
        flipY: true,
      };
      settings.exposure = 1;
      // The decoder retries orientation and MIME variants before giving up, so
      // reaching it at all proves geometry passed the capability check.
      await expect(renderDevelopInBrowser(new Blob(["synthetic"]), settings)).rejects.toThrow(
        "could not be decoded",
      );
      expect(decodeCalls).toBeGreaterThanOrEqual(1);
    } finally {
      if (previous) Object.defineProperty(globalThis, "createImageBitmap", previous);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  });

  test("decoding cannot change the recipe that passed the capability check", async () => {
    const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const settings = defaultDevelopSettings();
    let closed = false;
    const pixels = new Uint8ClampedArray([128, 128, 128, 255]);
    const canvas = {
      width: 1,
      height: 1,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: pixels }),
        putImageData: () => {},
      }),
      toBlob: (done: (blob: Blob) => void) => done(new Blob([JSON.stringify([...pixels])])),
    };
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: async () => {
        settings.exposure = 1;
        settings.curve[0]!.y = 1;
        return {
          width: 1,
          height: 1,
          close: () => {
            closed = true;
          },
        };
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => canvas },
    });
    try {
      const rendered = await renderDevelopInBrowser(new Blob(["synthetic"]), settings);
      expect(await rendered.text()).toBe("[128,128,128,255]");
      expect(settings.exposure).toBe(1);
      expect(settings.curve[0]!.y).toBe(1);
      expect(closed).toBe(true);
    } finally {
      if (previousBitmap) Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

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
