import { describe, expect, test } from "bun:test";
import { NativeAdmissionPool } from "../src/server/native-admission";

const signal = () => new AbortController().signal;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("bounded native admission before source transfer", () => {
  test("reserves each lane once, queues FIFO, and rejects replayed leases", async () => {
    const pool = new NativeAdmissionPool(2, 2);
    try {
      const first = await pool.reserve(signal());
      const second = await pool.reserve(signal());
      expect(first).toMatch(/^[a-f0-9]{48}$/);
      expect(second).not.toBe(first);
      const a = pool.claim(first);
      const b = pool.claim(second);
      expect(a).not.toBe(b);
      expect(() => pool.claim(first)).toThrow("expired");
      const order: number[] = [];
      const third = pool.reserve(signal()).then((token) => {
        order.push(3);
        return token;
      });
      const fourth = pool.reserve(signal()).then((token) => {
        order.push(4);
        return token;
      });
      await expect(pool.reserve(signal())).rejects.toMatchObject({ status: 429 });
      expect(() => pool.claim()).toThrow("busy");
      pool.release(b);
      expect(pool.claim(await third)).toBe(b);
      expect(order).toEqual([3]);
      pool.release(a);
      expect(pool.claim(await fourth)).toBe(a);
      expect(order).toEqual([3, 4]);
    } finally {
      pool.close();
    }
  });

  test("cancellation removes a waiting job without consuming capacity", async () => {
    const pool = new NativeAdmissionPool(1, 1);
    try {
      const lane = pool.claim(await pool.reserve(signal()));
      const controller = new AbortController();
      const waiting = pool.reserve(controller.signal);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ status: 499 });
      const next = pool.reserve(signal());
      pool.release(lane);
      expect(pool.claim(await next)).toBe(lane);
      await expect(pool.reserve(AbortSignal.abort())).rejects.toMatchObject({ status: 499 });
    } finally {
      pool.close();
    }
  });

  test("abandoned reservations expire, claimed work never does", async () => {
    const pool = new NativeAdmissionPool(1, 2, 1000, 10);
    try {
      const abandoned = await pool.reserve(signal());
      const waiting = pool.reserve(signal());
      const token = await waiting;
      expect(() => pool.claim(abandoned)).toThrow("expired");
      const lane = pool.claim(token);
      await sleep(25);
      expect(() => pool.claim()).toThrow("busy");
      pool.release(lane);
      expect(pool.claim()).toBe(lane);
    } finally {
      pool.close();
    }
  });

  test("queue timeout and shutdown settle all pending requests", async () => {
    const pool = new NativeAdmissionPool(1, 2, 10, 1000);
    const held = await pool.reserve(signal());
    const timeout = expect(pool.reserve(signal())).rejects.toMatchObject({ status: 429 });
    await sleep(25);
    await timeout;
    const pending = pool.reserve(signal());
    pool.close();
    await expect(pending).rejects.toMatchObject({ status: 499 });
    expect(() => pool.claim(held)).toThrow("closed");
    await expect(pool.reserve(signal())).rejects.toMatchObject({ status: 499 });
  });
  test("bounds reject invalid configuration and support zero waiting slots", async () => {
    for (const lanes of [0, 17, 1.5, NaN]) expect(() => new NativeAdmissionPool(lanes)).toThrow();
    const pool = new NativeAdmissionPool(1, 0);
    try {
      const token = await pool.reserve(signal());
      await expect(pool.reserve(signal())).rejects.toMatchObject({ status: 429 });
      pool.release(pool.claim(token));
    } finally {
      pool.close();
    }
  });
});
