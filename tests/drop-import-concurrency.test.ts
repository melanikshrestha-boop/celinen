import { describe, expect, test } from "bun:test";
import { collectDroppedFiles } from "../src/lib/studio/drop-import";

const source = (name: string) => new File([name], name, { type: "image/jpeg" });
const transfer = (entry: FileSystemEntry) =>
  ({
    files: [],
    items: [{ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => null }],
  }) as unknown as DataTransfer;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bounded streaming folder discovery", () => {
  test("1,000 entries read eight at once, stream before completion, and retain traversal order", async () => {
    const pending: Array<{ index: number; finish: () => void }> = [];
    let active = 0,
      peak = 0,
      directoryActive = 0,
      directoryPeak = 0,
      reads = 0;
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      name: `${index}.jpg`,
      fullPath: `/${index}.jpg`,
      isFile: true,
      isDirectory: false,
      file: (success: (file: File) => void) => {
        active++;
        peak = Math.max(peak, active);
        pending.push({
          index,
          finish: () => {
            active--;
            success(source(`${index}.jpg`));
          },
        });
      },
    })) as unknown as FileSystemEntry[];
    const folder = {
      name: "shoot",
      fullPath: "/shoot",
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (success: (entries: FileSystemEntry[]) => void) => {
          directoryActive++;
          directoryPeak = Math.max(directoryPeak, directoryActive);
          const batch = entries.slice(reads * 100, ++reads * 100);
          queueMicrotask(() => {
            directoryActive--;
            success(batch);
          });
        },
      }),
    } as unknown as FileSystemEntry;
    const controller = new AbortController(),
      streamed: File[] = [];
    const run = collectDroppedFiles(transfer(folder), {
      signal: controller.signal,
      onFiles: (files) => streamed.push(...files),
    });
    try {
      await tick();
      expect(active).toBe(8);
      // Resolve in reverse completion order; presentation still follows source traversal.
      pending
        .splice(0)
        .reverse()
        .forEach((item) => item.finish());
      await tick();
      expect(streamed.map((file) => file.name)).toEqual(
        Array.from({ length: 8 }, (_, i) => `${i}.jpg`),
      );
      expect(active).toBe(8);
      while (streamed.length < 1000) {
        pending
          .splice(0)
          .reverse()
          .forEach((item) => item.finish());
        await tick();
      }
      const result = await run;
      expect(peak).toBe(8);
      expect(directoryPeak).toBe(1);
      expect(reads).toBe(11);
      expect(result.files).toEqual(streamed);
      expect(result.files.map((file) => file.webkitRelativePath)).toEqual(
        entries.map((entry) => `shoot/${entry.name}`),
      );
      expect(result.warnings).toEqual([]);
    } finally {
      controller.abort();
      await run.catch(() => {});
    }
  });

  test("cancellation stops all eight reads and late callbacks never stream into another session", async () => {
    const callbacks: Array<(file: File) => void> = [];
    const entries = Array.from({ length: 20 }, (_, i) => ({
      name: `${i}.jpg`,
      fullPath: `/${i}.jpg`,
      isFile: true,
      isDirectory: false,
      file: (success: (file: File) => void) => callbacks.push(success),
    })) as unknown as FileSystemEntry[];
    let reads = 0;
    const folder = {
      name: "shoot",
      fullPath: "/shoot",
      isDirectory: true,
      isFile: false,
      createReader: () => ({
        readEntries: (success: (files: FileSystemEntry[]) => void) =>
          success(reads++ ? [] : entries),
      }),
    } as unknown as FileSystemEntry;
    const controller = new AbortController(),
      streamed: File[] = [];
    const run = collectDroppedFiles(transfer(folder), {
      signal: controller.signal,
      onFiles: (files) => streamed.push(...files),
    });
    await tick();
    const started = callbacks.length;
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    callbacks.forEach((callback, i) => callback(source(`${i}.jpg`)));
    await tick();
    expect(started).toBe(8);
    expect(callbacks).toHaveLength(8);
    expect(streamed).toEqual([]);
  });

  test("stream observers cannot remove files, and repeated handles retain exact-path deduplication", async () => {
    const file = source("same.jpg");
    const entry = {
      name: file.name,
      fullPath: "/same.jpg",
      isFile: true,
      isDirectory: false,
      file: (success: (file: File) => void) => success(file),
    } as unknown as FileSystemEntry;
    const data = transfer(entry);
    Object.assign(data, { items: [...Array.from(data.items), ...Array.from(data.items)] });
    let calls = 0;
    const result = await collectDroppedFiles(data, {
      onFiles: () => {
        calls++;
        throw new Error("Unmounted observer");
      },
    });
    expect(calls).toBe(1);
    expect(result.files).toEqual([file]);
    expect(result.duplicates).toBe(1);
  });
});
