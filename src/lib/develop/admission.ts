export type DevelopAdmission = {
  raw: boolean;
  exclusive: boolean;
  priority?: "interactive" | "background";
  signal?: AbortSignal;
};
type Waiting = {
  admission: DevelopAdmission;
  start: () => void;
  reject: (reason: unknown) => void;
  abort: () => void;
};
const cancelled = () => new DOMException("Develop processing cancelled.", "AbortError");

/**
 * Queue before transferring originals. Mirrors native's two requests / one RAW /
 * exclusive high-resolution bounds without replacing native-side authorization.
 */
export function createDevelopAdmissionQueue() {
  const pending: Waiting[] = [];
  let active = 0,
    raw = 0,
    exclusive = false;
  const eligible = (job: Waiting) =>
    !exclusive &&
    active < 2 &&
    (!job.admission.raw || raw < 1) &&
    (!job.admission.exclusive || active === 0);
  function drain() {
    while (active < 2) {
      // Interactive selections can move ahead of pending background previews.
      // Within each priority, preserve FIFO; bypass RAW waiters for raster work.
      const interactive = pending.findIndex(
        (job) => job.admission.priority !== "background" && eligible(job),
      );
      const index = interactive < 0 ? pending.findIndex(eligible) : interactive;
      if (index < 0) return;
      const job = pending.splice(index, 1)[0]!;
      job.admission.signal?.removeEventListener("abort", job.abort);
      job.start();
    }
  }
  function run<T>(admission: DevelopAdmission, work: () => Promise<T>): Promise<T> {
    if (admission.signal?.aborted) return Promise.reject(admission.signal.reason ?? cancelled());
    if (pending.length >= 128)
      return Promise.reject(new Error("Develop queue is full. Let existing previews finish."));
    return new Promise<T>((resolve, reject) => {
      const job: Waiting = {
        admission,
        reject,
        abort() {
          const index = pending.indexOf(job);
          if (index >= 0) {
            pending.splice(index, 1);
            reject(admission.signal?.reason ?? cancelled());
          }
          drain();
        },
        start() {
          active++;
          if (admission.raw) raw++;
          if (admission.exclusive) exclusive = true;
          void Promise.resolve()
            .then(() => {
              admission.signal?.throwIfAborted();
              return work();
            })
            .then(resolve, reject)
            .finally(() => {
              active--;
              if (admission.raw) raw--;
              if (admission.exclusive) exclusive = false;
              drain();
            });
        },
      };
      admission.signal?.addEventListener("abort", job.abort, { once: true });
      pending.push(job);
      drain();
    });
  }
  return { run, snapshot: () => ({ active, raw, exclusive, pending: pending.length }) };
}
