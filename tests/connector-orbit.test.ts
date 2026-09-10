import { expect, test } from "bun:test";
import { orbitPose, RING_OMEGA, RING_R } from "../src/lib/connector-orbit";

test("1000-frame orbit stays on-ring, fades below the horizon, inner counter-rotates", () => {
  expect(RING_OMEGA[0]).toBeGreaterThan(0);
  expect(RING_OMEGA[1]).toBeGreaterThan(0);
  expect(RING_OMEGA[2]).toBeLessThan(0);
  expect(Math.abs(RING_OMEGA[0])).toBeLessThan(0.2);
  expect(Math.abs(RING_OMEGA[1])).toBeLessThan(0.2);

  const rings: { ring: 0 | 1 | 2; count: number }[] = [
    { ring: 0, count: 7 },
    { ring: 1, count: 5 },
    { ring: 2, count: 3 },
  ];
  let visibleFrames = 0;
  for (let frame = 0; frame < 1000; frame++) {
    const time = frame / 60;
    for (const { ring, count } of rings) {
      let visible = 0;
      for (let i = 0; i < count; i++) {
        const pose = orbitPose(ring, i, count, time);
        expect(Number.isFinite(pose.x)).toBe(true);
        expect(Number.isFinite(pose.y)).toBe(true);
        expect(Math.abs(Math.hypot(pose.x, pose.y) - RING_R[ring])).toBeLessThan(0.0001);
        expect(pose.opacity).toBeGreaterThanOrEqual(0);
        expect(pose.opacity).toBeLessThanOrEqual(1);
        if (pose.y > 0) expect(pose.opacity).toBe(0);
        if (pose.opacity > 0.05) visible++;
      }
      if (visible > 0) visibleFrames++;
    }
  }
  expect(visibleFrames).toBeGreaterThan(900);
});
