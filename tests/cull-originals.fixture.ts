/** In-memory stand-ins for the browser's file handles and private file system,
 * with the failure modes the real ones have: missing entries, revoked access,
 * a quota that refuses writes. */
import type { OpfsDirectory, OpfsFileHandle, OpfsWritable } from "../src/lib/studio/cull/opfs";
import type {
  CullDirectoryHandle,
  CullFileHandle,
  CullPermission,
} from "../src/lib/studio/cull/sources";
import type { CullFrame } from "../src/lib/studio/cull/session";

// ---------------------------------------------------------------------------
// File System Access handles (the photographer's card).

export type Permission = { state: CullPermission; onRequest?: () => CullPermission };

function notAllowed() {
  return new DOMException("Permission is not granted.", "NotAllowedError");
}
function notFound(name: string) {
  return new DOMException(`${name} was not found.`, "NotFoundError");
}

export class MockFile implements CullFileHandle {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    public content: string,
    public lastModified: number,
    readonly permission: Permission = { state: "granted" },
  ) {}
  async queryPermission() {
    return this.permission.state;
  }
  async requestPermission() {
    if (this.permission.onRequest) this.permission.state = this.permission.onRequest();
    return this.permission.state;
  }
  async getFile() {
    if (this.permission.state !== "granted") throw notAllowed();
    return new File([this.content], this.name, {
      type: this.name.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "",
      lastModified: this.lastModified,
    });
  }
}

export class MockDirectory implements CullDirectoryHandle {
  readonly kind = "directory" as const;
  readonly children = new Map<string, MockFile | MockDirectory>();
  lookups = 0;
  constructor(
    readonly name: string,
    readonly permission: Permission = { state: "granted" },
  ) {}
  async queryPermission() {
    return this.permission.state;
  }
  async requestPermission() {
    if (this.permission.onRequest) this.permission.state = this.permission.onRequest();
    return this.permission.state;
  }
  /** Adds a file at a path below this folder, creating folders on the way. */
  add(path: string, content: string, lastModified: number): MockFile {
    const [first, ...rest] = path.split("/");
    if (rest.length) {
      let child = this.children.get(first!);
      if (!child) {
        child = new MockDirectory(first!, this.permission);
        this.children.set(first!, child);
      }
      return (child as MockDirectory).add(rest.join("/"), content, lastModified);
    }
    const file = new MockFile(first!, content, lastModified, this.permission);
    this.children.set(file.name, file);
    return file;
  }
  async getDirectoryHandle(name: string) {
    this.lookups += 1;
    if (this.permission.state !== "granted") throw notAllowed();
    const child = this.children.get(name);
    if (!child) throw notFound(name);
    if (child.kind !== "directory") throw new DOMException("Not a folder.", "TypeMismatchError");
    return child;
  }
  async getFileHandle(name: string) {
    if (this.permission.state !== "granted") throw notAllowed();
    const child = this.children.get(name);
    if (!child) throw notFound(name);
    if (child.kind !== "file") throw new DOMException("Not a file.", "TypeMismatchError");
    return child;
  }
  async *values() {
    if (this.permission.state !== "granted") throw notAllowed();
    yield* this.children.values();
  }
}

/** A frame as the ingest pool records it for a file at `path`. */
export function frameFor(
  path: string,
  content: string,
  lastModified: number,
  extra: Partial<CullFrame> = {},
): CullFrame {
  const bytes = new Blob([content]).size;
  const name = path.split("/").at(-1)!;
  return {
    id: `${path}:${bytes}:${lastModified}:0`,
    name,
    ...(path.includes("/") ? { relativePath: path } : {}),
    width: 6000,
    height: 4000,
    bytes,
    lastModified,
    captureTimeMs: null,
    verdict: "undecided",
    decided: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The Origin Private File System, with a quota.

export class FakeStorage {
  usage = 0;
  persisted = false;
  persistCalls = 0;
  constructor(public quota: number) {}
  charge(delta: number) {
    if (delta > 0 && this.usage + delta > this.quota)
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.usage += delta;
  }
  api() {
    return {
      estimate: async () => ({ quota: this.quota, usage: this.usage }),
      persist: async () => {
        this.persistCalls += 1;
        this.persisted = true;
        return true;
      },
      persisted: async () => this.persisted,
    };
  }
}

export class FakeOpfsFile implements OpfsFileHandle {
  readonly kind = "file" as const;
  data = new Uint8Array();
  constructor(
    readonly storage: FakeStorage,
    readonly name: string,
  ) {}
  async getFile() {
    return new File([this.data], this.name, { type: "image/jpeg" });
  }
  async createWritable(): Promise<OpfsWritable> {
    const chunks: Uint8Array[] = [];
    return {
      write: async (data) => {
        const bytes =
          data instanceof Blob
            ? new Uint8Array(await data.arrayBuffer())
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : new Uint8Array(data);
        chunks.push(bytes.slice());
      },
      close: async () => {
        const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        this.storage.charge(size - this.data.length);
        const next = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          next.set(chunk, at);
          at += chunk.length;
        }
        this.data = next;
      },
      abort: async () => {},
    };
  }
}

export class FakeOpfsDirectory implements OpfsDirectory {
  readonly kind = "directory" as const;
  readonly entries = new Map<string, FakeOpfsDirectory | FakeOpfsFile>();
  constructor(
    readonly storage: FakeStorage,
    readonly name = "",
  ) {}
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    let entry = this.entries.get(name);
    if (!entry && options.create) {
      entry = new FakeOpfsDirectory(this.storage, name);
      this.entries.set(name, entry);
    }
    if (!entry) throw notFound(name);
    if (entry.kind !== "directory") throw new DOMException("Not a folder.", "TypeMismatchError");
    return entry;
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    let entry = this.entries.get(name);
    if (!entry && options.create) {
      entry = new FakeOpfsFile(this.storage, name);
      this.entries.set(name, entry);
    }
    if (!entry) throw notFound(name);
    if (entry.kind !== "file") throw new DOMException("Not a file.", "TypeMismatchError");
    return entry;
  }
  async removeEntry(name: string, options: { recursive?: boolean } = {}) {
    const entry = this.entries.get(name);
    if (!entry) throw notFound(name);
    if (entry.kind === "directory" && entry.entries.size && !options.recursive)
      throw new DOMException("The folder is not empty.", "InvalidModificationError");
    this.storage.charge(-bytesIn(entry));
    this.entries.delete(name);
  }
  /** Every file below this folder, by path. */
  files(prefix = ""): Map<string, number> {
    const found = new Map<string, number>();
    for (const [name, entry] of this.entries) {
      if (entry.kind === "file") found.set(`${prefix}${name}`, entry.data.length);
      else for (const [path, size] of entry.files(`${prefix}${name}/`)) found.set(path, size);
    }
    return found;
  }
}

function bytesIn(entry: FakeOpfsDirectory | FakeOpfsFile): number {
  if (entry.kind === "file") return entry.data.length;
  let total = 0;
  for (const child of entry.entries.values()) total += bytesIn(child);
  return total;
}
