/** An in-memory File System Access directory, faithful where the hand-off
 * layer depends on it: case-insensitive names (like APFS/NTFS), NotFoundError
 * and TypeMismatchError, and writables that commit to a swap file only on
 * close. Faults can be injected per path. */
import type { DirectoryHandleLike, FileHandleLike } from "../src/lib/studio/cull/handoff/types";

type Faults = {
  /** Writes whose path matches throw after streaming half their bytes. */
  failWrites?: RegExp;
  /** Writes whose path matches commit one byte short. */
  truncateWrites?: RegExp;
  /** Delay per written chunk, ms. */
  chunkDelayMs?: number;
};

export type FakeStats = {
  writesInFlight: number;
  maxWritesInFlight: number;
  commits: string[];
};

class FakeFileNode {
  constructor(
    public name: string,
    public data: Uint8Array,
    public lastModified: number,
  ) {}
}

function notFound(name: string) {
  return new DOMException(`${name} was not found.`, "NotFoundError");
}

function typeMismatch(name: string) {
  return new DOMException(`${name} is the wrong kind of entry.`, "TypeMismatchError");
}

export class FakeDirectory implements DirectoryHandleLike {
  readonly kind = "directory" as const;
  readonly entries = new Map<string, FakeDirectory | FakeFileNode>();

  constructor(
    public readonly name: string,
    readonly path: string,
    readonly faults: Faults,
    readonly stats: FakeStats,
  ) {}

  static root(faults: Faults = {}): FakeDirectory {
    return new FakeDirectory("root", "", faults, {
      writesInFlight: 0,
      maxWritesInFlight: 0,
      commits: [],
    });
  }

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<FakeDirectory> {
    const existing = this.entries.get(name.toLowerCase());
    if (existing instanceof FakeDirectory) return existing;
    if (existing) throw typeMismatch(name);
    if (!options.create) throw notFound(name);
    const dir = new FakeDirectory(name, this.join(name), this.faults, this.stats);
    this.entries.set(name.toLowerCase(), dir);
    return dir;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileHandleLike> {
    let existing = this.entries.get(name.toLowerCase());
    if (existing instanceof FakeDirectory) throw typeMismatch(name);
    if (!existing) {
      if (!options.create) throw notFound(name);
      existing = new FakeFileNode(name, new Uint8Array(), Date.now());
      this.entries.set(name.toLowerCase(), existing);
    }
    return this.handleFor(existing);
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    const existing = this.entries.get(name.toLowerCase());
    if (!existing) throw notFound(name);
    if (existing instanceof FakeDirectory && existing.entries.size && !options.recursive)
      throw new DOMException("Directory not empty.", "InvalidModificationError");
    this.entries.delete(name.toLowerCase());
  }

  async *keys(): AsyncIterable<string> {
    for (const entry of this.entries.values()) yield entry.name;
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  // --- test helpers -------------------------------------------------------

  private join(name: string) {
    return this.path ? `${this.path}/${name}` : name;
  }

  /** Puts a file at a slash path, creating folders. */
  put(path: string, data: Uint8Array | string, lastModified = 1_700_000_000_000): void {
    const segments = path.split("/");
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- walking down from this folder
    let dir: FakeDirectory = this;
    for (const segment of segments.slice(0, -1)) {
      let next = dir.entries.get(segment.toLowerCase());
      if (!next) {
        next = new FakeDirectory(segment, dir.join(segment), this.faults, this.stats);
        dir.entries.set(segment.toLowerCase(), next);
      }
      if (!(next instanceof FakeDirectory)) throw new Error(`${segment} is a file`);
      dir = next;
    }
    const name = segments[segments.length - 1]!;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    dir.entries.set(name.toLowerCase(), new FakeFileNode(name, bytes, lastModified));
  }

  /** The bytes at a slash path, or null. */
  read(path: string): Uint8Array | null {
    const segments = path.split("/");
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- walking down from this folder
    let node: FakeDirectory | FakeFileNode | undefined = this;
    for (const segment of segments) {
      if (!(node instanceof FakeDirectory)) return null;
      node = node.entries.get(segment.toLowerCase());
    }
    return node instanceof FakeFileNode ? node.data : null;
  }

  text(path: string): string | null {
    const bytes = this.read(path);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  /** Every file path under this folder, with original casing, sorted. */
  list(): string[] {
    const out: string[] = [];
    const walk = (dir: FakeDirectory, prefix: string) => {
      for (const entry of dir.entries.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry instanceof FakeDirectory) walk(entry, path);
        else out.push(path);
      }
    };
    walk(this, "");
    return out.sort();
  }

  private handleFor(node: FakeFileNode): FileHandleLike {
    const faults = this.faults;
    const stats = this.stats;
    const path = this.join(node.name);
    return {
      kind: "file",
      name: node.name,
      getFile: async () =>
        new File([node.data as BlobPart], node.name, { lastModified: node.lastModified }),
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        let written = 0;
        stats.writesInFlight += 1;
        stats.maxWritesInFlight = Math.max(stats.maxWritesInFlight, stats.writesInFlight);
        let open = true;
        const finish = () => {
          if (open) stats.writesInFlight -= 1;
          open = false;
        };
        return new WritableStream<Uint8Array>({
          async write(chunk) {
            if (faults.chunkDelayMs) await new Promise((r) => setTimeout(r, faults.chunkDelayMs));
            if (faults.failWrites?.test(path) && written > 0) throw new Error("Disk full");
            chunks.push(chunk.slice());
            written += chunk.length;
          },
          close() {
            finish();
            let size = chunks.reduce((s, c) => s + c.length, 0);
            if (faults.failWrites?.test(path)) throw new Error("Disk full");
            if (faults.truncateWrites?.test(path)) size = Math.max(0, size - 1);
            const data = new Uint8Array(size);
            let at = 0;
            for (const chunk of chunks) {
              const take = Math.min(chunk.length, size - at);
              data.set(chunk.subarray(0, take), at);
              at += take;
            }
            // Commit: the swap file replaces the original only now.
            node.data = data;
            node.lastModified = Date.now();
            stats.commits.push(path);
          },
          abort() {
            finish();
          },
        });
      },
    };
  }
}

export function file(
  path: string,
  data: Uint8Array | string,
  lastModified = 1_700_000_000_000,
): File {
  const name = path.split("/").pop()!;
  const f = new File([data as BlobPart], name, { lastModified });
  // Directory imports expose where the file sat on the card.
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

export function bytes(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed * 2654435761;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
