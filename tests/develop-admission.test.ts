import { expect, test } from "bun:test";
import { createDevelopAdmissionQueue } from "../src/lib/develop/admission";
const tick = () => new Promise((done) => setTimeout(done, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("queues before upload, keeping one RAW and two total jobs while raster bypasses a waiting RAW", async () => {
  const queue = createDevelopAdmissionQueue(),
    gate = deferred(),
    starts: string[] = [];
  const first = queue.run({ raw: true, exclusive: false }, async () => {
    starts.push("raw1");
    await gate.promise;
  });
  const second = queue.run({ raw: true, exclusive: false }, async () => {
    starts.push("raw2");
  });
  const third = queue.run({ raw: false, exclusive: false }, async () => {
    starts.push("jpeg");
  });
  await tick();
  expect(starts).toEqual(["raw1", "jpeg"]);
  expect(queue.snapshot().raw).toBe(1);
  gate.resolve();
  await Promise.all([first, second, third]);
  await tick();
  expect(starts).toEqual(["raw1", "jpeg", "raw2"]);
  expect(queue.snapshot().active).toBe(0);
});
test("high-resolution jobs run exclusively and cancelled waiters never upload", async () => {
  const queue = createDevelopAdmissionQueue(),
    gate = deferred(),
    controller = new AbortController();
  let uploaded = false;
  const high = queue.run({ raw: true, exclusive: true }, () => gate.promise);
  const waiting = queue.run(
    { raw: false, exclusive: false, signal: controller.signal },
    async () => {
      uploaded = true;
    },
  );
  controller.abort();
  await expect(waiting).rejects.toThrow();
  expect(uploaded).toBe(false);
  expect(queue.snapshot()).toEqual({ active: 1, raw: 1, exclusive: true, pending: 0 });
  gate.resolve();
  await high;
});
test("interactive selection runs ahead of queued background previews without cancelling originals", async () => {
  const queue = createDevelopAdmissionQueue(),
    gate = deferred(),
    starts: string[] = [];
  const first = queue.run({ raw: false, exclusive: true }, () => gate.promise);
  const background = queue.run(
    { raw: true, exclusive: false, priority: "background" },
    async () => {
      starts.push("background");
    },
  );
  const selected = queue.run({ raw: true, exclusive: false }, async () => {
    starts.push("selected");
  });
  gate.resolve();
  await Promise.all([first, background, selected]);
  expect(starts).toEqual(["selected", "background"]);
});
