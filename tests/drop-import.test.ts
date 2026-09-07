import { describe, expect, test } from "bun:test";
import { collectDroppedFiles, type DropProgress } from "../src/lib/studio/drop-import";
import { sidecarKey, uniquePhotos } from "../src/lib/studio/ingest";

function file(name: string, contents = name): File {
  return new File([contents], name, {
    type: name.endsWith(".xmp") ? "application/xml" : "image/jpeg",
    lastModified: 123,
  });
}

function fileEntry(source: File, path = `/${source.name}`, fail = false): FileSystemEntry {
  return {
    name: source.name,
    fullPath: path,
    isFile: true,
    isDirectory: false,
    file: (success: (file: File) => void, error: (reason: Error) => void) => {
      if (fail) error(new Error("Permission denied"));
      else success(source);
    },
  } as unknown as FileSystemFileEntry;
}

function directory(name: string, batches: FileSystemEntry[][], failAt = -1) {
  const count = { reads: 0 };
  const entry = {
    name,
    fullPath: `/${name}`,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (
          success: (entries: FileSystemEntry[]) => void,
          error: (reason: Error) => void,
        ) => {
          count.reads++;
          if (index === failAt) error(new Error("Folder unavailable"));
          else success(batches[index++] ?? []);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
  return { entry, count };
}

function transfer(
  roots: Array<{ entry?: FileSystemEntry; file?: File }>,
  flat: File[] = [],
): DataTransfer {
  return {
    files: flat,
    items: roots.map((root) => ({
      kind: "file",
      webkitGetAsEntry: () => root.entry ?? null,
      getAsFile: () => root.file ?? null,
    })),
  } as unknown as DataTransfer;
}

describe("safe folder drops", () => {
  test("captures every entry and fallback synchronously before the drop store closes", async () => {
    let available = true;
    let captured = 0;
    const sources = [file("first.jpg"), file("second.jpg")];
    const data = {
      get files() {
        return available ? sources : [];
      },
      items: sources.map((source) => ({
        kind: "file",
        webkitGetAsEntry: () => {
          if (!available) throw new Error("Store closed");
          captured++;
          return fileEntry(source);
        },
        getAsFile: () => {
          if (!available) throw new Error("Store closed");
          captured++;
          return source;
        },
      })),
    } as unknown as DataTransfer;
    const pending = collectDroppedFiles(data);
    available = false;
    expect(captured).toBe(4);
    expect((await pending).files.map((source) => source.name)).toEqual(["first.jpg", "second.jpg"]);
  });

  test("reads successive Chrome-sized batches through the final empty batch", async () => {
    const entries = Array.from({ length: 203 }, (_, i) => fileEntry(file(`${i}.jpg`)));
    const folder = directory("match", [
      entries.slice(0, 100),
      entries.slice(100, 200),
      entries.slice(200),
    ]);
    const result = await collectDroppedFiles(transfer([{ entry: folder.entry }]));
    expect(result.files.length).toBe(203);
    expect(result.files[202]!.webkitRelativePath).toBe("match/202.jpg");
    expect(folder.count.reads).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  test("preserves nested camera-card paths and sidecars without mutating source Files", async () => {
    const a = file("IMG_0001.jpg", "same bytes");
    const b = file("IMG_0001.jpg", "same bytes");
    const xmp = file("IMG_0001.xmp", "<xmp/>");
    const cardA = directory("card-A", [[fileEntry(a), fileEntry(xmp)]]);
    const cardB = directory("card-B", [[fileEntry(b)]]);
    const shoot = directory("shoot", [[cardA.entry, cardB.entry]]);
    const result = await collectDroppedFiles(transfer([{ entry: shoot.entry }]));
    expect(result.files.map((source) => source.webkitRelativePath)).toEqual([
      "shoot/card-A/IMG_0001.jpg",
      "shoot/card-A/IMG_0001.xmp",
      "shoot/card-B/IMG_0001.jpg",
    ]);
    expect(uniquePhotos(result.files).length).toBe(2);
    expect(sidecarKey(result.files[0]!)).toBe(sidecarKey(result.files[1]!));
    expect(sidecarKey(result.files[2]!)).not.toBe(sidecarKey(result.files[1]!));
    expect(result.files[0]!.lastModified).toBe(a.lastModified);
    expect(result.files[0]!.type).toBe(a.type);
    expect(await result.files[0]!.text()).toBe(await a.text());
    expect(a.webkitRelativePath || "").toBe("");
    expect(result.files[0]).not.toBe(a);
    expect(result.directories).toBe(3);
  });

  test("does not append flat-list duplicates or a folder placeholder after directory traversal", async () => {
    const photo = file("frame.jpg");
    const folder = directory("shoot", [[fileEntry(photo)]]);
    const result = await collectDroppedFiles(
      transfer([{ entry: folder.entry }], [new File([], "shoot"), photo]),
    );
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.webkitRelativePath).toBe("shoot/frame.jpg");
  });

  test("deduplicates overlapping directory/direct-file entries using their complete relative path", async () => {
    const photo = file("frame.jpg");
    const folder = directory("shoot", [[fileEntry(photo)]]);
    const result = await collectDroppedFiles(
      transfer([{ entry: folder.entry }, { entry: fileEntry(photo, "/shoot/frame.jpg") }]),
    );
    expect(result.files.length).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  test("supports plain Files when items or directory entry APIs are absent", async () => {
    const photo = file("plain.jpg");
    const xmp = file("plain.xmp");
    const result = await collectDroppedFiles({
      files: [photo, xmp],
      items: [],
    } as unknown as DataTransfer);
    expect(result.files).toEqual([photo, xmp]);
    expect(result.warnings).toEqual([]);
    const fallback = await collectDroppedFiles({
      files: [photo],
      items: [{ kind: "file", getAsFile: () => photo }],
    } as unknown as DataTransfer);
    expect(fallback.files).toEqual([photo]);
  });

  test("uses synchronously captured FileList and getAsFile fallbacks if entry access fails", async () => {
    const photo = file("fallback.jpg");
    const failedMethod = {
      kind: "file",
      webkitGetAsEntry: () => {
        throw new Error("Unavailable");
      },
      getAsFile: () => null,
    };
    expect(
      (
        await collectDroppedFiles({
          files: [photo],
          items: [failedMethod],
        } as unknown as DataTransfer)
      ).files,
    ).toEqual([photo]);
    expect(
      (
        await collectDroppedFiles(
          transfer([{ entry: fileEntry(photo, "/fallback.jpg", true), file: photo }]),
        )
      ).files,
    ).toEqual([photo]);
  });

  test("reports empty folders and unreadable entries while retaining other readable files", async () => {
    const empty = directory("empty", []);
    const blocked = directory("blocked", [], 0);
    const shoot = directory("shoot", [
      [
        empty.entry,
        blocked.entry,
        fileEntry(file("bad.jpg"), "/bad.jpg", true),
        fileEntry(file("good.jpg")),
      ],
    ]);
    const result = await collectDroppedFiles(transfer([{ entry: shoot.entry }]));
    expect(result.files.map((source) => source.name)).toEqual(["good.jpg"]);
    expect(result.warnings.map((warning) => [warning.code, warning.path])).toEqual([
      ["empty-folder", "shoot/empty"],
      ["unreadable", "shoot/blocked"],
      ["unreadable", "shoot/bad.jpg"],
    ]);
  });

  test("retains a readable first batch when a later directory batch fails", async () => {
    const folder = directory("shoot", [[fileEntry(file("first.jpg"))]], 1);
    const result = await collectDroppedFiles(transfer([{ entry: folder.entry }]));
    expect(result.files.length).toBe(1);
    expect(result.warnings[0]!.code).toBe("unreadable");
  });

  test("does not loop on repeated batches or cyclic entry handles", async () => {
    const repeated = fileEntry(file("repeat.jpg"));
    const loop = directory("loop", [[repeated], [repeated], [repeated]]);
    const result = await collectDroppedFiles(transfer([{ entry: loop.entry }]));
    expect(result.files.length).toBe(1);
    expect(loop.count.reads).toBe(2);
    expect(result.warnings[0]!.code).toBe("repeated-directory");
    const batches: FileSystemEntry[][] = [];
    const cyclic = directory("cycle", batches);
    batches.push([cyclic.entry]);
    expect((await collectDroppedFiles(transfer([{ entry: cyclic.entry }]))).warnings[0]!.code).toBe(
      "repeated-directory",
    );
  });

  test("rejects unsafe path components without skipping valid later batches", async () => {
    const folder = directory("shoot", [
      [fileEntry(file("../escape.jpg"))],
      [fileEntry(file("safe.jpg"))],
    ]);
    const result = await collectDroppedFiles(transfer([{ entry: folder.entry }]));
    expect(result.files.map((source) => source.name)).toEqual(["safe.jpg"]);
    expect(result.warnings[0]!.code).toBe("invalid-path");
  });

  test("bounds deeply nested directories without recursive stack growth", async () => {
    let entry = fileEntry(file("deep.jpg"));
    for (let i = 0; i < 100; i++) entry = directory(`level-${i}`, [[entry]]).entry;
    const result = await collectDroppedFiles(transfer([{ entry }]));
    expect(result.files.length).toBe(0);
    expect(result.warnings.some((warning) => warning.code === "limit")).toBe(true);
  });

  test("rejects cancellation while a browser file callback never returns", async () => {
    const controller = new AbortController();
    let called = false;
    const stalled = {
      name: "stalled.jpg",
      fullPath: "/stalled.jpg",
      isFile: true,
      isDirectory: false,
      file: () => {
        called = true;
      },
    } as unknown as FileSystemEntry;
    const pending = collectDroppedFiles(transfer([{ entry: stalled }]), {
      signal: controller.signal,
    });
    expect(called).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("yields to review/paint/cancel events during a 3,000-file drop", async () => {
    const entries = Array.from({ length: 3000 }, (_, index) => fileEntry(file(`${index}.jpg`)));
    const folder = directory(
      "match",
      Array.from({ length: 30 }, (_, index) => entries.slice(index * 100, index * 100 + 100)),
    );
    let eventLoopRan = false;
    let sawMidImport = false;
    let progress: DropProgress | undefined;
    setTimeout(() => {
      eventLoopRan = true;
      sawMidImport = (progress?.files ?? 3000) < 3000;
    }, 0);
    const result = await collectDroppedFiles(transfer([{ entry: folder.entry }]), {
      onProgress: (value) => {
        progress = value;
      },
    });
    expect(result.files.length).toBe(3000);
    expect(eventLoopRan).toBe(true);
    expect(sawMidImport).toBe(true);
    expect(progress!.files).toBe(3000);
    expect(result.warnings).toEqual([]);
  });

  test("returns an explicit warning for an empty/non-file drop", async () => {
    const result = await collectDroppedFiles({
      files: [],
      items: [{ kind: "string" }],
    } as unknown as DataTransfer);
    expect(result.files).toEqual([]);
    expect(result.warnings[0]!.code).toBe("empty-drop");
  });
});
