import { beforeEach, describe, expect, test } from "bun:test";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  },
});

import {
  EXPORT_NIGHT_KIT_STORAGE_KEY,
  activeWatermarkKit,
  defaultWatermarkKits,
  dressedExportSize,
  exportDressingKey,
  findWatermarkKitByName,
  loadExportNightKitStore,
  resolveClientWatermarkKitName,
  runSerialExportQueue,
  saveExportNightKitStore,
  sanitizeExportBorder,
  upsertWatermarkKit,
} from "../src/lib/develop/export-night-kit";

beforeEach(() => {
  memory.clear();
});

describe("watermark kit persistence", () => {
  test("ships three named kits and reloads the active choice", () => {
    const defaults = defaultWatermarkKits();
    expect(defaults.map((kit) => kit.name)).toEqual([
      "Client proof",
      "Brand corner",
      "Web mark",
    ]);
    const saved = saveExportNightKitStore({
      kits: defaults,
      activeKitId: defaults[1]!.id,
      border: sanitizeExportBorder({ enabled: true, widthRatio: 0.04, color: "#111111" }),
    });
    expect(localStorage.getItem(EXPORT_NIGHT_KIT_STORAGE_KEY)).toContain("Brand corner");
    const loaded = loadExportNightKitStore();
    expect(loaded.activeKitId).toBe(defaults[1]!.id);
    expect(activeWatermarkKit(loaded)?.name).toBe("Brand corner");
    expect(loaded.border.enabled).toBe(true);
    expect(loaded.border.color).toBe("#111111");
    expect(saved.kits).toHaveLength(3);
  });

  test("upsert renames a kit without dropping siblings", () => {
    const store = loadExportNightKitStore();
    const first = store.kits[0]!;
    const next = upsertWatermarkKit(store, { ...first, name: "Agency proof", text: "AGENCY" });
    expect(next.kits.map((kit) => kit.name)).toContain("Agency proof");
    expect(next.kits).toHaveLength(3);
    expect(next.kits.filter((kit) => kit.id === first.id)).toHaveLength(1);
    expect(loadExportNightKitStore().kits.find((kit) => kit.id === first.id)?.text).toBe("AGENCY");
  });

  test("legacy client On/Off resolves into kit names", () => {
    const kits = defaultWatermarkKits();
    expect(resolveClientWatermarkKitName("On", kits)).toBe("Client proof");
    expect(resolveClientWatermarkKitName("Off", kits)).toBe("");
    expect(resolveClientWatermarkKitName("Brand corner", kits)).toBe("Brand corner");
    expect(findWatermarkKitByName(kits, "On")?.id).toBe("kit-client-proof");
    expect(findWatermarkKitByName(kits, "Off")).toBeNull();
  });
});

describe("border sizing + dressing key", () => {
  test("border grows both axes and key changes with kit or border", () => {
    const off = dressedExportSize(2000, 1500, sanitizeExportBorder({ enabled: false }));
    expect(off).toEqual({ width: 2000, height: 1500, inset: 0 });
    const on = dressedExportSize(
      2000,
      1500,
      sanitizeExportBorder({ enabled: true, widthRatio: 0.05, color: "#fff" }),
    );
    expect(on.inset).toBe(100);
    expect(on.width).toBe(2200);
    expect(on.height).toBe(1700);
    const kit = defaultWatermarkKits()[0]!;
    const a = exportDressingKey({
      border: sanitizeExportBorder({ enabled: true, widthRatio: 0.03, color: "#ffffff" }),
      kit,
    });
    const b = exportDressingKey({
      border: sanitizeExportBorder({ enabled: true, widthRatio: 0.03, color: "#000000" }),
      kit,
    });
    const c = exportDressingKey({
      border: sanitizeExportBorder({ enabled: true, widthRatio: 0.03, color: "#ffffff" }),
      kit: { ...kit, text: "OTHER" },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("serial export queue", () => {
  test("exports one after another and isolates per-file failures", async () => {
    const order: string[] = [];
    const result = await runSerialExportQueue(
      ["a", "b", "c", "d"],
      async (item) => {
        order.push(`start:${item}`);
        await Promise.resolve();
        if (item === "b") throw new Error("disk full on b");
        order.push(`done:${item}`);
      },
    );
    expect(order).toEqual([
      "start:a",
      "done:a",
      "start:b",
      "start:c",
      "done:c",
      "start:d",
      "done:d",
    ]);
    expect(result.completed).toBe(3);
    expect(result.cancelled).toBe(false);
    expect(result.failures).toEqual([{ index: 1, item: "b", message: "disk full on b" }]);
  });

  test("cancel stops the next batch without corrupting finished work", async () => {
    const controller = new AbortController();
    const order: string[] = [];
    const result = await runSerialExportQueue(
      ["1", "2", "3"],
      async (item) => {
        order.push(item);
        await Promise.resolve();
        if (item === "1") controller.abort();
      },
      { signal: controller.signal },
    );
    expect(order).toEqual(["1"]);
    expect(result.completed).toBe(1);
    expect(result.cancelled).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("progress reports serial ordering", async () => {
    const progress: number[] = [];
    await runSerialExportQueue(["x", "y", "z"], async () => {}, {
      onProgress: (done, total) => progress.push(done / total),
    });
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });
});
