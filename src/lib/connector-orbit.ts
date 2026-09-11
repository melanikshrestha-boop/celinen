/** Vugola-measured orbit: viewBox 900×450, center at bottom (450, 450). */
export const VIEW_W = 900;
export const VIEW_H = 450;
export const CX = 450;
export const CY = 450;
export const RING_R = [405, 288, 171] as const;
/** rad/s — outer, mid, inner (inner counter-rotates). Slowed: the old 0.575 felt like a scramble. */
export const RING_OMEGA = [0.12, 0.15, -0.038] as const;

export type OrbitPose = { x: number; y: number; opacity: number; radius: number };

export function orbitPose(ring: 0 | 1 | 2, index: number, count: number, time: number): OrbitPose {
  const radius = RING_R[ring];
  const base = (index / Math.max(count, 1)) * Math.PI * 2;
  const theta = base + RING_OMEGA[ring] * time;
  const x = radius * Math.cos(theta);
  const y = radius * Math.sin(theta);
  const rise = -y / radius;
  const opacity = rise <= 0 ? 0 : Math.min(1, rise / 0.16);
  return { x, y, opacity, radius };
}

export function scaleOrbit(width: number): number {
  return width > 0 ? width / VIEW_W : 1;
}
