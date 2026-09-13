import { randomBytes } from "node:crypto";

export class NativeAdmissionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Waiter = {
  signal: AbortSignal;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};
type Lease = { lane: number; timer: ReturnType<typeof setTimeout> };

/** Reserve a decoder with a small request BEFORE transferring an original.
 * Queued requests hold no photo bytes. Tokens are single-use and expire when
 * a client disappears between admission and upload. Processing never expires
 * a claimed lane: only its owner may release it in its finally block.
 */
export class NativeAdmissionPool {
  private occupied = new Set<number>();
  private leases = new Map<string, Lease>();
  private waiting: Waiter[] = [];
  private closed = false;
  constructor(
    private lanes = 4,
    private maximumWaiting = 32,
    private queueTimeoutMs = 30_000,
    private leaseTimeoutMs = 15_000,
  ) {
    if (
      !Number.isInteger(lanes) ||
      lanes < 1 ||
      lanes > 16 ||
      !Number.isInteger(maximumWaiting) ||
      maximumWaiting < 0 ||
      maximumWaiting > 256 ||
      !Number.isFinite(queueTimeoutMs) ||
      queueTimeoutMs <= 0 ||
      !Number.isFinite(leaseTimeoutMs) ||
      leaseTimeoutMs <= 0
    )
      throw new Error("Invalid native admission bounds.");
  }
  private freeLane() {
    for (let lane = 0; lane < this.lanes; lane++) if (!this.occupied.has(lane)) return lane;
    return undefined;
  }
  private lease(lane: number) {
    this.occupied.add(lane);
    const token = randomBytes(24).toString("hex");
    const timer = setTimeout(() => {
      this.leases.delete(token);
      this.release(lane);
    }, this.leaseTimeoutMs);
    timer.unref?.();
    this.leases.set(token, { lane, timer });
    return token;
  }
  reserve(signal: AbortSignal): Promise<string> {
    if (signal.aborted || this.closed)
      return Promise.reject(new NativeAdmissionError(499, "Native job cancelled."));
    const lane = this.freeLane();
    if (lane !== undefined && this.waiting.length === 0) return Promise.resolve(this.lease(lane));
    if (this.waiting.length >= this.maximumWaiting)
      return Promise.reject(
        new NativeAdmissionError(429, "Native queue is full. Try again shortly."),
      );
    return new Promise((resolve, reject) => {
      const remove = (error: Error) => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        waiter.cleanup();
        reject(error);
      };
      const abort = () => remove(new NativeAdmissionError(499, "Native job cancelled."));
      const timer = setTimeout(
        () => remove(new NativeAdmissionError(429, "Native queue timed out. Try again shortly.")),
        this.queueTimeoutMs,
      );
      timer.unref?.();
      const waiter: Waiter = {
        signal,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        },
      };
      this.waiting.push(waiter);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  claim(token?: string): number {
    if (this.closed) throw new NativeAdmissionError(503, "Native queue is closed.");
    if (token !== undefined) {
      const lease = this.leases.get(token);
      if (!lease)
        throw new NativeAdmissionError(
          410,
          "Native reservation expired. Reserve again before uploading.",
        );
      this.leases.delete(token);
      clearTimeout(lease.timer);
      return lease.lane;
    }
    // Backward-compatible callers can use a free lane, never jump the queue.
    const lane = this.freeLane();
    if (lane === undefined || this.waiting.length)
      throw new NativeAdmissionError(
        429,
        "Native workers are busy. Reserve a slot before uploading.",
      );
    this.occupied.add(lane);
    return lane;
  }
  release(lane: number) {
    this.occupied.delete(lane);
    if (this.closed) return;
    while (this.waiting.length) {
      const available = this.freeLane();
      if (available === undefined) return;
      const waiter = this.waiting.shift()!;
      waiter.cleanup();
      if (waiter.signal.aborted) {
        waiter.reject(new NativeAdmissionError(499, "Native job cancelled."));
        continue;
      }
      waiter.resolve(this.lease(available));
    }
  }
  close() {
    this.closed = true;
    for (const lease of this.leases.values()) clearTimeout(lease.timer);
    this.leases.clear();
    this.occupied.clear();
    for (const waiter of this.waiting) {
      waiter.cleanup();
      waiter.reject(new NativeAdmissionError(499, "Native job cancelled."));
    }
    this.waiting = [];
  }
}
