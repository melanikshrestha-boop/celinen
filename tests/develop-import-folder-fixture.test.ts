import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { collectDroppedFiles } from "../src/lib/studio/drop-import";

const source = await readFile(
  new URL("./develop-import-lifecycle.browser.js", import.meta.url),
  "utf8",
);
const folderFunction = source.slice(
  source.indexOf("  function dropFolder("),
  source.indexOf("  function assertHistory("),
);

// Native DataTransferItemList access may expose a new JS wrapper each time.
// Mutating the wrapper returned by add() is therefore not a directory fixture.
class WrapperChangingTransfer {
  files: File[] = [];
  get items() {
    const files = this.files;
    const wrap = (file: File) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
      webkitGetAsEntry: () => null,
    });
    return {
      add(file: File) {
        files.push(file);
        return wrap(file);
      },
      *[Symbol.iterator]() {
        for (const file of files) yield wrap(file);
      },
    };
  }
}
class SyntheticDragEvent {
  readonly type: string;
  readonly dataTransfer: DataTransfer;
  constructor(type: string, init: { dataTransfer: DataTransfer }) {
    this.type = type;
    this.dataTransfer = init.dataTransfer;
  }
}
function harness() {
  const controller = new AbortController();
  let pending: ReturnType<typeof collectDroppedFiles> | undefined;
  const lifecycle: Record<string, unknown> = {};
  const root = () => ({
    dispatchEvent(event: SyntheticDragEvent) {
      pending = collectDroppedFiles(event.dataTransfer, { signal: controller.signal });
      void pending.catch(() => undefined);
    },
  });
  const dropFolder = new Function(
    "DataTransfer",
    "DragEvent",
    "root",
    "lifecycle",
    "persistLifecycle",
    `${folderFunction}\nreturn dropFolder;`,
  )(WrapperChangingTransfer, SyntheticDragEvent, root, lifecycle, () => undefined) as (
    reader: (success: (entries: FileSystemEntry[]) => void) => void,
    name: string,
  ) => void;
  return { dropFolder, controller, lifecycle, pending: () => pending! };
}

test("patching only the add-returned item loses the directory handle on wrapper churn", async () => {
  const transfer = new WrapperChangingTransfer();
  const item = transfer.items.add(new File(["synthetic directory handle"], "qa-folder"));
  Object.defineProperty(item, "getAsEntry", { value: () => ({ isDirectory: true }) });
  expect([...transfer.items][0]).not.toBe(item);
  expect("getAsEntry" in [...transfer.items][0]!).toBe(false);
  const result = await collectDroppedFiles(transfer as unknown as DataTransfer);
  expect(result.files.map((file) => file.name)).toEqual(["qa-folder"]);
  expect(result.directories).toBe(0);
});

test("actual lifecycle drop helper captures a cancellable directory without importing its placeholder", async () => {
  const h = harness();
  let complete: ((entries: FileSystemEntry[]) => void) | undefined;
  h.dropFolder((success) => {
    complete = success;
  }, "qa-delayed-folder");
  try {
    expect(complete).toBeDefined();
    h.controller.abort();
    await expect(h.pending()).rejects.toMatchObject({ name: "AbortError" });
    complete!([]);
    await expect(h.pending()).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    h.controller.abort();
    await h.pending().catch(() => undefined);
  }
});

test("actual lifecycle drop helper exposes unreadable directory warnings, not fake file failures", async () => {
  const h = harness();
  let calls = 0;
  h.dropFolder(() => {
    calls++;
    throw new Error("Synthetic unreadable folder");
  }, "qa-unreadable-folder");
  const result = await h.pending();
  expect(calls).toBe(1);
  expect(result.files).toEqual([]);
  expect(result.warnings.map((warning) => [warning.code, warning.path])).toEqual([
    ["unreadable", "qa-unreadable-folder"],
  ]);
});
