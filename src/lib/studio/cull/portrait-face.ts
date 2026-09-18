/** A face box in the upright frame, 0..1. */
export type PortraitFace = { x: number; y: number; width: number; height: number };

export type FaceHint = { x: number; y: number; w: number; h: number };

export type FaceFind = PortraitFace & { turned: 0 | 90 | 270 };

function isSkin(r: number, g: number, b: number): boolean {
  // YCbCr for tungsten/street night. Cr must actually be warm, or gray pavement
  // and cool walls light up as skin and swallow the head.
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (y >= 24 && y <= 240 && cr >= 135 && cr <= 180 && cb >= 77 && cb <= 127) return true;
  if (r < 52 || g < 28 || b < 14) return false;
  if (r < g - 4 || r < b) return false;
  if (Math.abs(r - g) < 8) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) > 12;
}

function rotate90cw(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const dx = height - 1 - y;
      const dy = x;
      const di = (dy * height + dx) * 4;
      out[di] = rgba[si]!;
      out[di + 1] = rgba[si + 1]!;
      out[di + 2] = rgba[si + 2]!;
      out[di + 3] = rgba[si + 3]!;
    }
  }
  return { rgba: out, width: height, height: width };
}

function rotate90ccw(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const dx = y;
      const dy = width - 1 - x;
      const di = (dy * height + dx) * 4;
      out[di] = rgba[si]!;
      out[di + 1] = rgba[si + 1]!;
      out[di + 2] = rgba[si + 2]!;
      out[di + 3] = rgba[si + 3]!;
    }
  }
  return { rgba: out, width: height, height: width };
}

function mapBoxFrom90cw(box: PortraitFace): PortraitFace {
  return {
    x: box.y,
    y: 1 - (box.x + box.width),
    width: box.height,
    height: box.width,
  };
}

function mapBoxFrom90ccw(box: PortraitFace): PortraitFace {
  return {
    x: 1 - (box.y + box.height),
    y: box.x,
    width: box.height,
    height: box.width,
  };
}

function findInOrientation(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  hint?: FaceHint,
): PortraitFace | null {
  if (width < 16 || height < 16 || rgba.length < width * height * 4) return null;
  const cols = Math.min(96, width);
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
      skin[gy * cols + gx] = n && hits / n > 0.32 ? 1 : 0;
    }
  }
  const seen = new Uint8Array(cols * rows);
  let best: { score: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const stack: number[] = [];
  for (let start = 0; start < skin.length; start++) {
    if (!skin[start] || seen[start]) continue;
    let x0 = cols,
      y0 = rows,
      x1 = 0,
      y1 = 0,
      area = 0;
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
    const cx = (x0 + x1) / 2 / cols;
    const cy = (y0 + y1) / 2 / rows;
    const onHint =
      hint &&
      cx >= hint.x &&
      cx <= hint.x + hint.w &&
      cy >= hint.y &&
      cy <= hint.y + hint.h;
    if (frac < (onHint ? 0.002 : 0.003) || frac > 0.62) continue;
    if (aspect < 0.35 || aspect > (onHint ? 2.6 : 2.2)) continue;
    if (cy > 0.88) continue;
    let score = area * (onHint ? 2.4 : 1);
    // A head is taller than it is wide when the frame is the right way up.
    if (aspect >= 0.55 && aspect <= 1.15) score *= 1.25;
    if (!best || score > best.score) best = { score, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const padX = (best.x1 - best.x0 + 1) * 0.14;
  const padY = (best.y1 - best.y0 + 1) * 0.2;
  const x = Math.max(0, (best.x0 - padX) / cols);
  const y = Math.max(0, (best.y0 - padY) / rows);
  const right = Math.min(1, (best.x1 + 1 + padX) / cols);
  const bottom = Math.min(1, (best.y1 + 1 + padY) / rows);
  return { x, y, width: right - x, height: bottom - y };
}

/** Largest skin-colored region that looks like a head, trying 90° if the RAW is still on its side. */
export function findPortraitFace(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  hint?: FaceHint,
): PortraitFace | null {
  return findPortraitFaceOriented(rgba, width, height, hint)?.box ?? null;
}

export function findPortraitFaceOriented(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  hint?: FaceHint,
): { box: PortraitFace; turned: 0 | 90 | 270 } | null {
  const upright = findInOrientation(rgba, width, height, hint);
  const score = (box: PortraitFace | null) =>
    box ? box.width * box.height * (box.height >= box.width * 0.85 ? 1.45 : 0.65) : 0;
  const upScore = score(upright);
  if (upright && upright.height >= upright.width * 0.75 && upScore > 0)
    return { box: upright, turned: 0 };
  const cw = rotate90cw(rgba, width, height);
  const onCw = findInOrientation(cw.rgba, cw.width, cw.height);
  const ccw = rotate90ccw(rgba, width, height);
  const onCcw = findInOrientation(ccw.rgba, ccw.width, ccw.height);
  const cwScore = score(onCw);
  const ccwScore = score(onCcw);
  if (upright && upScore >= cwScore && upScore >= ccwScore) return { box: upright, turned: 0 };
  if (onCw && cwScore >= ccwScore) return { box: mapBoxFrom90cw(onCw), turned: 90 };
  if (onCcw) return { box: mapBoxFrom90ccw(onCcw), turned: 270 };
  if (upright) return { box: upright, turned: 0 };
  return null;
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
