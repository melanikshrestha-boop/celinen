// Isolated fake-child lifecycle, not a native image quality or HTTP test.
import { spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

class Child extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kills: string[] = [];
  constructor(public args: string[]) {
    super();
  }
  kill(signal: string) {
    this.kills.push(signal);
    return true;
  }
}
const children: Child[] = [];
spyOn(childProcess, "spawn").mockImplementation(((_binary: string, args: string[]) => {
  const child = new Child(args);
  children.push(child);
  return child;
}) as unknown as typeof childProcess.spawn);
const timers: { callback: () => void; delay: number; cleared: boolean }[] = [];
globalThis.setTimeout = ((callback: () => void, delay: number) => {
  const timer = { callback, delay, cleared: false };
  timers.push(timer);
  return timer;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((timer: (typeof timers)[number]) => {
  timer.cleared = true;
}) as unknown as typeof clearTimeout;
const { createDevelopProcessingLanes, runNativeDevelop } =
  await import("../src/server/native-develop");
const lanes = createDevelopProcessingLanes();
const emptyLanes = { requests: 0, processing: 0, rawProcessing: 0, highResolution: false };
let passed = 0;
function check(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
  passed++;
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function header(width: number, height: number) {
  return Buffer.from([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    218,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    1,
    255,
    217,
  ]);
}
function start() {
  const controller = new AbortController(),
    lease = lanes.acquireRequest();
  lease.start({ edge: 8192, sourceMode: "raw" });
  let outcome: unknown = undefined,
    completions = 0;
  const pending = runNativeDevelop(
    "synthetic-binary",
    "synthetic.photo",
    defaultDevelopSettings(),
    8192,
    0.9,
    controller.signal,
    "raw",
  ).finally(() => lease.release());
  const observed = pending.then(
    (result) => {
      outcome = result;
      completions++;
      return result;
    },
    (error: unknown) => {
      outcome = error;
      completions++;
      return error;
    },
  );
  return {
    controller,
    child: children.at(-1)!,
    observed,
    outcome: () => outcome,
    completions: () => completions,
  };
}
const preAborted = new AbortController();
preAborted.abort();
let preError: unknown;
try {
  await runNativeDevelop(
    "synthetic-binary",
    "synthetic.photo",
    defaultDevelopSettings(),
    8192,
    0.9,
    preAborted.signal,
  );
} catch (error) {
  preError = error;
}
check(
  (preError as { status?: number })?.status === 499 && children.length === 0,
  "Already-cancelled work spawned a child.",
);

const cancelled = start();
if (!cancelled.child)
  throw new Error(`The isolated spawn mock did not start: ${String(await cancelled.observed)}`);
cancelled.controller.abort();
await settle();
check(
  cancelled.child.kills.join() === "SIGKILL",
  "Cancellation did not kill the child exactly once.",
);
check(
  cancelled.outcome() === undefined &&
    lanes.snapshot().highResolution &&
    lanes.snapshot().processing === 1,
  "Cancellation released the exclusive lane before actual child close.",
);
const blocked = lanes.acquireRequest();
let blockedError: unknown;
try {
  blocked.start({ edge: 4096, sourceMode: "preview" });
} catch (error) {
  blockedError = error;
}
check(
  (blockedError as { status?: number })?.status === 429,
  "A second process overlapped a still-exiting high-resolution child.",
);
blocked.release();
cancelled.child.emit("close", null);
const cancelledResult = await cancelled.observed;
check(
  (cancelledResult as { status?: number }).status === 499 && cancelled.completions() === 1,
  "Child close lost the cancellation error or settled twice.",
);
check(
  JSON.stringify(lanes.snapshot()) === JSON.stringify(emptyLanes),
  "Closed cancelled child leaked its processing/request lease.",
);
cancelled.child.emit("close", 0);
check(cancelled.completions() === 1, "Duplicate close settled the request twice.");

const timedOut = start();
check(
  timers.at(-1)!.delay === 60_000,
  "High-resolution work weakened the 60-second native deadline.",
);
timers.at(-1)!.callback();
await settle();
check(
  timedOut.outcome() === undefined &&
    timedOut.child.kills.length === 1 &&
    lanes.snapshot().highResolution,
  "Timeout released high-resolution ownership before child close.",
);
timedOut.child.emit("close", null);
check(
  ((await timedOut.observed) as { status?: number }).status === 504,
  "Native timeout lost its exact error after child close.",
);

const failedSpawn = start();
failedSpawn.child.emit("error", new Error("Synthetic spawn failure"));
await settle();
check(
  failedSpawn.outcome() === undefined && lanes.snapshot().processing === 1,
  "Spawn failure released ownership before close.",
);
failedSpawn.child.emit("close", -2);
const spawnError = await failedSpawn.observed;
check(
  spawnError instanceof Error &&
    spawnError.message.includes("could not start") &&
    failedSpawn.completions() === 1,
  "Spawn error/close did not settle once with the original failure.",
);
check(
  JSON.stringify(lanes.snapshot()) === JSON.stringify(emptyLanes),
  "Spawn failure leaked a lease.",
);

const oversized = start();
oversized.child.stdout.emit("data", Buffer.alloc(32 * 1024 * 1024 + 1));
oversized.child.stdout.emit("data", Buffer.from("ignored after failure"));
await settle();
check(
  oversized.child.kills.length === 1 && oversized.outcome() === undefined,
  "Oversized JPEG did not wait for killed process closure.",
);
oversized.child.emit("close", 0);
const sizeError = await oversized.observed;
check(
  (sizeError as { status?: number }).status === 413 && oversized.completions() === 1,
  "Oversized output did not keep the exact failure after close.",
);

const malformed = start();
malformed.child.stdout.emit("data", Buffer.from([255, 216, 255, 217]));
malformed.child.emit("close", 0);
check(
  (await malformed.observed) instanceof Error,
  "Malformed successful child output bypassed receipt validation.",
);

const wrongDimensions = start();
wrongDimensions.child.stdout.emit("data", header(6001, 6000));
wrongDimensions.child.emit("close", 0);
check(
  ((await wrongDimensions.observed) as { status?: number }).status === 502,
  "Above-36MP child output bypassed the receipt guard.",
);

const successful = start(),
  jpeg = header(6024, 4024);
successful.child.stdout.emit("data", jpeg.subarray(0, 8));
successful.child.stdout.emit("data", jpeg.subarray(8));
successful.child.stderr.emit("data", Buffer.from("synthetic stderr is never returned"));
check(
  successful.child.args.join("|") === "synthetic.photo|8192|0.9|raw",
  "High-resolution process arguments changed source mode or quality.",
);
successful.child.emit("close", 0);
const successResult = await successful.observed;
check(
  Buffer.isBuffer(successResult) && successResult.equals(jpeg) && successful.completions() === 1,
  "Successful high-resolution receipt was modified or settled twice.",
);
check(
  successful.child.kills.length === 0 &&
    JSON.stringify(lanes.snapshot()) === JSON.stringify(emptyLanes),
  "Successful process was killed or leaked a lease.",
);

for (const child of children) {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}
process.stdout.write(JSON.stringify({ passed }));
