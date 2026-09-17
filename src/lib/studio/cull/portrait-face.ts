/** A face box in the upright frame, 0..1. */
export type PortraitFace = { x: number; y: number; width: number; height: number };

function isSkin(r: number, g: number, b: number): boolean {
  // Kovac RGB skin test: works on a camera JPEG without a neural net, and in
  // Safari which has no FaceDetector. Tuned for a real face under mixed light,
  // not a perfect Fitzpatrick sweep — jewelry and a headpiece still leave skin.
  if (r < 60 || g < 30 || b < 15) return false;
  if (r < g || r < b) return false;
  if (Math.abs(r - g) < 10) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 12;
}

/** Largest skin-colored region that looks like a head, or null. */
export function findPortraitFace(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): PortraitFace | null {
  if (width < 16 || height < 16 || rgba.length < width * height * 4) return null;
  const cols = Math.min(80, width);
  const rows = Math.max(8, Math.round((height * cols) / width));
  const skin = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / cols));
      let hits = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          n++;
          if (isSkin(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)) hits++;
        }
      }
      skin[gy * cols + gx] = n && hits / n > 0.45 ? 1 : 0;
    }
  }
  const seen = new Uint8Array(cols * rows);
  let best: { area: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const stack: number[] = [];
  for (let start = 0; start < skin.length; start++) {
    if (!skin[start] || seen[start]) continue;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0, area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const gx = i % cols;
      const gy = (i - gx) / cols;
      area++;
      if (gx < x0) x0 = gx;
      if (gy < y0) y0 = gy;
      if (gx > x1) x1 = gx;
      if (gy > y1) y1 = gy;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
        const j = ny * cols + nx;
        if (!skin[j] || seen[j]) return;
        seen[j] = 1;
        stack.push(j);
      };
      push(gx - 1, gy);
      push(gx + 1, gy);
      push(gx, gy - 1);
      push(gx, gy + 1);
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const frac = area / (cols * rows);
    const aspect = bw / Math.max(1, bh);
    const cy = (y0 + y1) / 2 / rows;
    if (frac < 0.006 || frac > 0.5) continue;
    if (aspect < 0.45 || aspect > 1.85) continue;
    if (cy > 0.82) continue;
    if (!best || area > best.area) best = { area, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const padX = (best.x1 - best.x0 + 1) * 0.12;
  const padY = (best.y1 - best.y0 + 1) * 0.18;
  const x = Math.max(0, (best.x0 - padX) / cols);
  const y = Math.max(0, (best.y0 - padY) / rows);
  const right = Math.min(1, (best.x1 + 1 + padX) / cols);
  const bottom = Math.min(1, (best.y1 + 1 + padY) / rows);
  return { x, y, width: right - x, height: bottom - y };
}

export function cullFaceFromBox(box: PortraitFace, sharpness = -1, eyesOpen: boolean | null = null) {
  return { x: box.x, y: box.y, width: box.width, height: box.height, sharpness, eyesOpen };
}

/** The region the loupe should paint, in source pixels, or null for the whole frame. */
export function loupeFaceCrop(
  box: PortraitFace | undefined,
  hasFace: boolean,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasFace || !box || width < 8 || height < 8) return null;
  const padX = box.width * 0.55;
  const padY = box.height * 0.75;
  let x = (box.x - padX) * width;
  let y = (box.y - padY * 0.9) * height;
  let w = (box.width + padX * 2) * width;
  let h = (box.height + padY * 1.7) * height;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > width) w = width - x;
  if (y + h > height) h = height - y;
  if (w < 16 || h < 16) return null;
  return { x, y, w, h };
}
