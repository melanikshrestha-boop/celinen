/** Decoded loupe pictures, kept for the few frames around the one in hand.
 *
 * Stepping through a burst is the loupe's hot path. Holding the decoded
 * neighbours means the next frame paints on the keypress rather than a decode
 * later, and capping the cache at a handful keeps a 10k-frame session from
 * holding gigabytes of pixels.
 */

type Entry<T> = { promise: Promise<T | null>; value: T | null; evicted: boolean };

export class DecodedLru<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(
    private readonly capacity: number,
    private readonly release: (value: T) => void,
  ) {}

  /** The cached value for `key`, decoding it once if needed. Concurrent calls share one decode. */
  get(key: string, decode: () => Promise<T | null>): Promise<T | null> {
    const existing = this.entries.get(key);
    if (existing) {
      // Most recently used moves to the back of the insertion order.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.promise;
    }
    const entry: Entry<T> = { promise: Promise.resolve(null), value: null, evicted: false };
    entry.promise = decode().then(
      (value) => {
        if (value === null) {
          this.drop(key, entry);
          return null;
        }
        // Evicted while decoding: nobody will ask for it again, so free it now.
        if (entry.evicted) {
          this.release(value);
          return null;
        }
        entry.value = value;
        return value;
      },
      () => {
        this.drop(key, entry);
        return null;
      },
    );
    this.entries.set(key, entry);
    this.trim();
    return entry.promise;
  }

  /** The decoded value, only if it is ready now. */
  peek(key: string): T | null {
    return this.entries.get(key)?.value ?? null;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get size() {
    return this.entries.size;
  }

  private drop(key: string, entry: Entry<T>) {
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }

  private trim() {
    while (this.entries.size > this.capacity) {
      const [oldest, entry] = this.entries.entries().next().value as [string, Entry<T>];
      this.entries.delete(oldest);
      entry.evicted = true;
      if (entry.value !== null) {
        this.release(entry.value);
        entry.value = null;
      }
    }
  }

  clear() {
    for (const entry of this.entries.values()) {
      entry.evicted = true;
      if (entry.value !== null) this.release(entry.value);
      entry.value = null;
    }
    this.entries.clear();
  }
}
