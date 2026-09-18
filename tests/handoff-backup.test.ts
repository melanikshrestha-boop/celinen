import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  MANIFEST_NAME,
  startBackupIngest,
  type BackupProgress,
} from "../src/lib/studio/cull/handoff/backup-ingest";
import {
  destinationSupport,
  ensurePermission,
  forgetDirectory,
  pickDestination,
  recallDirectory,
  rememberDirectory,
  startZipDownload,
} from "../src/lib/studio/cull/handoff/fs-access";
import { directoryTarget } from "../src/lib/studio/cull/handoff/target";
import type { DirectoryHandleLike } from "../src/lib/studio/cull/handoff/types";
import { bytes, FakeDirectory, file } from "./handoff-fs.fixture";

const noYield = async () => {};
// 2026-09-17 local noon, as a camera stamps file times.
const shotAt = new Date(2026, 8, 17, 12, 0, 0).getTime();

function cardFiles(count: number, size = 10_000) {
  return Array.from({ length: count }, (_, i) =>
    file(
      `DCIM/100MSDCF/_DSC${String(i + 1).padStart(4, "0")}.ARW`,
      bytes(size, i + 1),
      shotAt + i * 1000,
    ),
  );
}

describe("startBackupIngest", () => {
  test("copies to primary and secondary in dated shoot folders", async () => {
    const primary = FakeDirectory.root();
    const secondary = FakeDirectory.root();
    const files = cardFiles(5);
    const progress: BackupProgress[] = [];
    const backup = startBackupIngest({
      primary: directoryTarget(primary),
      secondary: directoryTarget(secondary),
      shootName: "State Finals",
      yieldBetweenFiles: noYield,
      onProgress: (p) => progress.push(p),
    });
    backup.add(files.slice(0, 3));
    backup.add(files.slice(3));
    backup.close();
    const report = await backup.done;

    for (const root of [primary, secondary]) {
      expect(root.list()).toEqual([
        MANIFEST_NAME,
        "2026-09-17 State Finals/_DSC0001.ARW",
        "2026-09-17 State Finals/_DSC0002.ARW",
        "2026-09-17 State Finals/_DSC0003.ARW",
        "2026-09-17 State Finals/_DSC0004.ARW",
        "2026-09-17 State Finals/_DSC0005.ARW",
      ]);
      expect([...root.read("2026-09-17 State Finals/_DSC0004.ARW")!]).toEqual([
        ...bytes(10_000, 4),
      ]);
    }
    expect(report.primary.copied).toHaveLength(5);
    expect(report.secondary!.copied).toHaveLength(5);
    expect(report.cancelled).toBe(false);
    const last = progress[progress.length - 1]!;
    expect(last.totalFiles).toBe(10);
    expect(last.files).toBe(10);
    expect(last.bytes).toBe(100_000);
    expect(last.secondary?.files).toBe(5);
  });

  test("resumes: a second run skips everything already copied, even renamed files", async () => {
    const primary = FakeDirectory.root();
    primary.put("2026-09-17/_DSC0002.ARW", "a different photo with the same name");
    const files = cardFiles(3);

    const first = startBackupIngest({
      primary: directoryTarget(primary),
      yieldBetweenFiles: noYield,
    });
    first.add(files);
    first.close();
    const one = await first.done;
    expect(one.primary.copied.map((c) => c.destination)).toEqual([
      "2026-09-17/_DSC0001.ARW",
      "2026-09-17/_DSC0002-1.ARW",
      "2026-09-17/_DSC0003.ARW",
    ]);
    expect(primary.text("2026-09-17/_DSC0002.ARW")).toBe("a different photo with the same name");

    // A new session: fresh handles over the same drive.
    const second = startBackupIngest({
      primary: directoryTarget(primary),
      yieldBetweenFiles: noYield,
    });
    second.add(files);
    second.close();
    const two = await second.done;
    expect(two.primary.copied).toEqual([]);
    expect(two.primary.skipped.map((s) => [s.destination, s.reason])).toEqual([
      ["2026-09-17/_DSC0001.ARW", "already-copied"],
      ["2026-09-17/_DSC0002-1.ARW", "already-copied"],
      ["2026-09-17/_DSC0003.ARW", "already-copied"],
    ]);
  });

  test("a changed file at the recorded path is copied again under a new name", async () => {
    const primary = FakeDirectory.root();
    const [original] = cardFiles(1);
    const first = startBackupIngest({
      primary: directoryTarget(primary),
      yieldBetweenFiles: noYield,
    });
    first.add([original!]);
    first.close();
    await first.done;
    primary.put("2026-09-17/_DSC0001.ARW", "truncated by a pulled cable");

    const second = startBackupIngest({
      primary: directoryTarget(primary),
      yieldBetweenFiles: noYield,
    });
    second.add([original!]);
    second.close();
    const report = await second.done;
    expect(report.primary.copied.map((c) => c.destination)).toEqual(["2026-09-17/_DSC0001-1.ARW"]);
  });

  test("one lane per destination by default, so the card stays free for the cull", async () => {
    const primary = FakeDirectory.root({ chunkDelayMs: 1 });
    const backup = startBackupIngest({
      primary: directoryTarget(primary),
      yieldBetweenFiles: noYield,
    });
    backup.add(cardFiles(6));
    backup.close();
    await backup.done;
    // The manifest save can overlap a copy; photo writes never overlap each other.
    expect(primary.stats.maxWritesInFlight).toBeLessThanOrEqual(2);
    expect(primary.list().filter((p) => p.endsWith(".ARW"))).toHaveLength(6);
  });

  test("pause holds the queue and resume drains it", async () => {
    const primary = FakeDirectory.root();
    const backup = startBackupIngest({
      primary: directoryTarget(primary),
      yieldBetweenFiles: noYield,
    });
    backup.pause();
    backup.add(cardFiles(3));
    backup.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(primary.list().filter((p) => p.endsWith(".ARW"))).toEqual([]);
    expect(backup.paused).toBe(true);
    backup.resume();
    const report = await backup.done;
    expect(report.primary.copied).toHaveLength(3);
  });

  test("cancel accounts for every file and leaves no partial copies", async () => {
    const primary = FakeDirectory.root({ chunkDelayMs: 10 });
    const controller = new AbortController();
    const backup = startBackupIngest({
      primary: directoryTarget(primary),
      signal: controller.signal,
      yieldBetweenFiles: noYield,
    });
    const files = cardFiles(10, 100_000);
    backup.add(files);
    while (primary.stats.commits.length < 1) await new Promise((r) => setTimeout(r, 1));
    controller.abort();
    const report = await backup.done;
    expect(report.cancelled).toBe(true);
    const { copied, skipped, failed } = report.primary;
    expect(copied.length + skipped.length + failed.length).toBe(10);
    expect(skipped.every((s) => s.reason === "cancelled")).toBe(true);
    for (const path of primary.list().filter((p) => p.endsWith(".ARW")))
      expect(primary.read(path)!.length).toBe(100_000);
    // The manifest records what did land, for the next run.
    const manifest = JSON.parse(primary.text(MANIFEST_NAME)!);
    expect(Object.keys(manifest.entries)).toHaveLength(copied.length);
  });

  test("a failing secondary does not stop the primary", async () => {
    const primary = FakeDirectory.root();
    const secondary = FakeDirectory.root({ failWrites: /\.ARW$/ });
    const backup = startBackupIngest({
      primary: directoryTarget(primary),
      secondary: directoryTarget(secondary),
      yieldBetweenFiles: noYield,
    });
    backup.add(cardFiles(2));
    backup.close();
    const report = await backup.done;
    expect(report.primary.copied).toHaveLength(2);
    expect(report.secondary!.failed.map((f) => f.reason)).toEqual(["Disk full", "Disk full"]);
    expect(secondary.list().filter((p) => p.endsWith(".ARW"))).toEqual([]);
  });

  test("rejects a bad template before copying, and more files after close", async () => {
    expect(() =>
      startBackupIngest({
        primary: directoryTarget(FakeDirectory.root()),
        folderTemplate: "{oops}",
      }),
    ).toThrow("Unknown token");
    const backup = startBackupIngest({
      primary: directoryTarget(FakeDirectory.root()),
      yieldBetweenFiles: noYield,
    });
    backup.close();
    expect(() => backup.add(cardFiles(1))).toThrow("closed");
    await backup.done;
  });
});

describe("fs-access", () => {
  test("support: folders in Chromium, a zip elsewhere", () => {
    expect(destinationSupport({ showDirectoryPicker: async () => FakeDirectory.root() })).toEqual({
      kind: "directory",
    });
    const safari = destinationSupport({});
    expect(safari.kind).toBe("zip");
    expect(destinationSupport({ isSecureContext: false })).toMatchObject({
      kind: "zip",
      reason: "Folder access needs a secure (https) page.",
    });
  });

  test("pick: picked, cancelled, unsupported", async () => {
    const idb = new IDBFactory();
    const folder = FakeDirectory.root();
    const picked = await pickDestination(
      { remember: "export", idb },
      { showDirectoryPicker: async () => folder },
    );
    expect(picked).toEqual({ kind: "picked", handle: folder });
    expect((await recallDirectory("export", idb))?.name).toBe("root");

    const cancelled = await pickDestination(
      {},
      {
        showDirectoryPicker: async () => {
          throw new DOMException("The user aborted a request.", "AbortError");
        },
      },
    );
    expect(cancelled).toEqual({ kind: "cancelled" });
    expect((await pickDestination({}, {})).kind).toBe("unsupported");
  });

  test("remembered folders survive and can be forgotten", async () => {
    const idb = new IDBFactory();
    const handle = { kind: "directory", name: "Backups" } as unknown as DirectoryHandleLike;
    await rememberDirectory("backup-primary", handle, idb);
    const recalled = await recallDirectory("backup-primary", idb);
    expect(recalled).toMatchObject({ name: "Backups", permission: "granted" });
    await forgetDirectory("backup-primary", idb);
    expect(await recallDirectory("backup-primary", idb)).toBeNull();
  });

  test("permission: query first, request only when asked", async () => {
    let requested = 0;
    const handle = {
      ...FakeDirectory.root(),
      queryPermission: async () => "prompt" as PermissionState,
      requestPermission: async () => {
        requested += 1;
        return "granted" as PermissionState;
      },
    } as unknown as DirectoryHandleLike;
    expect(await ensurePermission(handle)).toBe("prompt");
    expect(requested).toBe(0);
    expect(await ensurePermission(handle, { request: true })).toBe("granted");
    expect(requested).toBe(1);
  });

  test("zip download in memory hands over one archive", async () => {
    let saved: { blob: Blob; name: string } | null = null;
    const download = await startZipDownload("keepers.zip", {
      forceMemory: true,
      download: (blob, name) => {
        saved = { blob, name };
      },
    });
    expect(download.storage).toBe("memory");
    await download.writer.add("a.txt", new TextEncoder().encode("hello"));
    const result = await download.save();
    expect(saved!.name).toBe("keepers.zip");
    expect(saved!.blob.size).toBe(result.bytes);
  });
});
