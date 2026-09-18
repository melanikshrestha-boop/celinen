/** A face box in the upright frame, 0..1. */
export type PortraitFace = { x: number; y: number; width: number; height: number };

export type FaceHint = { x: number; y: number; w: number; h: number };

export type FaceFind = {
  /** Face in the original pixel space. */
  box: PortraitFace;
  /** Face after the frame is turned upright. Same as `box` when turned is 0. */
  uprightBox: PortraitFace;
  turned: 0 | 90 | 270;
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** Skin is a Cr–Cb ellipse, not a daylight RGB rule. Night, tungsten, and
 * darker skin still sit on the red-of-blue side of chroma; gray pavement does not. */
function skinScore(r: number, g: number, b: number): number {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (y < 12 || y > 248) return 0;
  const dcr = (cr - 150) / 32;
  const dcb = (cb - 108) / 28;
  const ellipse = dcr * dcr + dcb * dcb;
  let score = ellipse < 1.15 ? 1 - ellipse * 0.45 : 0;
  // Darker skin: lower luma, still warmer than blue. The daylight Cr floor
  // (135) is what called a night portrait "no face."
  if (y >= 14 && y < 95 && cr > cb + 6 && cr >= 122 && cb >= 70 && cb <= 135)
    score = Math.max(score, 0.82);
  // Tungsten / sodium: orange, not pink.
  if (y >= 18 && y <= 160 && r > g + 6 && r > b + 10 && cr >= 128 && cr <= 190 && cb <= 125)
    score = Math.max(score, 0.78);
  // Kovac RGB as a vote, never the only vote (it dies under neon).
  if (r >= 40 && g >= 16 && b >= 8 && r >= g && r > b && r - g >= 6 && Math.abs(r - g) >= 6) {
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > 10) score = Math.max(score, 0.62);
  }
  return score;
}

export function rotate90cw(
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

export function rotate90ccw(
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

export function uprightPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  turned: 0 | 90 | 270,
): { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } {
  if (turned === 90) return rotate90cw(rgba, width, height);
  if (turned === 270) return rotate90ccw(rgba, width, height);
  return { rgba, width, height };
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

function rotateHintCw(hint: FaceHint): FaceHint {
  return { x: 1 - (hint.y + hint.h), y: hint.x, w: hint.h, h: hint.w };
}

function rotateHintCcw(hint: FaceHint): FaceHint {
  return { x: hint.y, y: 1 - (hint.x + hint.w), w: hint.h, h: hint.w };
}

/** Camera AF (often an eye box) expanded to a head. The photographer already
 * put focus on a person; that is a face even when chroma is a mess. */
export function faceFromAf(af: FaceHint): PortraitFace | null {
  if (!(af.w > 0) || !(af.h > 0)) return null;
  const area = af.w * af.h;
  if (area > 0.58) return null;
  const cx = af.x + af.w / 2;
  const cy = af.y + af.h / 2;
  const headW = Math.min(0.64, Math.max(af.w * (area < 0.02 ? 4.2 : 2.4), 0.07));
  const headH = Math.min(0.8, Math.max(af.h * (area < 0.02 ? 5.4 : 3.1), 0.09));
  const x = clamp01(cx - headW / 2);
  const y = clamp01(cy - headH * 0.42);
  const width = Math.min(1 - x, headW);
  const height = Math.min(1 - y, headH);
  if (width < 0.04 || height < 0.05) return null;
  return { x, y, width, height };
}

function meanLuma(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: { x0: number; y0: number; x1: number; y1: number },
) {
  let sum = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(width, Math.ceil(box.x1));
  const y1 = Math.min(height, Math.ceil(box.y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      sum += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Darker patches where eyes sit make a skin blob a head, not a hand or a wall. */
function eyeRowBonus(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: { x0: number; y0: number; x1: number; y1: number },
) {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (bw < 4 || bh < 4) return 1;
  const face = meanLuma(rgba, width, height, box);
  const left = meanLuma(rgba, width, height, {
    x0: box.x0 + bw * 0.18,
    y0: box.y0 + bh * 0.28,
    x1: box.x0 + bw * 0.42,
    y1: box.y0 + bh * 0.48,
  });
  const right = meanLuma(rgba, width, height, {
    x0: box.x0 + bw * 0.58,
    y0: box.y0 + bh * 0.28,
    x1: box.x0 + bw * 0.82,
    y1: box.y0 + bh * 0.48,
  });
  const darker = (face - left + (face - right)) / 2;
  return darker > 6 ? 1.35 : darker > 2 ? 1.12 : 1;
}

type BlobHit = { score: number; x0: number; y0: number; x1: number; y1: number };

function findInOrientation(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  hint?: FaceHint,
): BlobHit | null {
  if (width < 16 || height < 16 || rgba.length < width * height * 4) return null;
  const cols = Math.min(96, width);
  const rows = Math.max(8, Math.round((height * cols) / width));
  const skin = new Float32Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          n++;
          sum += skinScore(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
        }
      }
      skin[gy * cols + gx] = n ? sum / n : 0;
    }
  }
  const marked = new Uint8Array(cols * rows);
  for (let i = 0; i < skin.length; i++) marked[i] = skin[i]! > 0.24 ? 1 : 0;
  const seen = new Uint8Array(cols * rows);
  let best: BlobHit | null = null;
  const stack: number[] = [];
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || seen[start]) continue;
    let x0 = cols,
      y0 = rows,
      x1 = 0,
      y1 = 0,
      area = 0,
      heat = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const gx = i % cols;
      const gy = (i - gx) / cols;
      area++;
      heat += skin[i]!;
      if (gx < x0) x0 = gx;
      if (gy < y0) y0 = gy;
      if (gx > x1) x1 = gx;
      if (gy > y1) y1 = gy;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
        const j = ny * cols + nx;
        if (!marked[j] || seen[j]) return;
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
    if (frac < (onHint ? 0.0012 : 0.0022) || frac > 0.68) continue;
    if (aspect < 0.28 || aspect > (onHint ? 2.8 : 2.35)) continue;
    if (cy > 0.9) continue;
    const px0 = (x0 / cols) * width;
    const py0 = (y0 / rows) * height;
    const px1 = ((x1 + 1) / cols) * width;
    const py1 = ((y1 + 1) / rows) * height;
    let score = heat * (onHint ? 2.6 : 1);
    if (aspect >= 0.5 && aspect <= 1.2) score *= 1.3;
    score *= eyeRowBonus(rgba, width, height, { x0: px0, y0: py0, x1: px1, y1: py1 });
    if (!best || score > best.score) best = { score, x0, y0, x1, y1 };
  }
  return best;
}

function boxFromBlob(best: BlobHit, cols: number, rows: number): PortraitFace {
  const padX = (best.x1 - best.x0 + 1) * 0.14;
  const padY = (best.y1 - best.y0 + 1) * 0.2;
  const x = Math.max(0, (best.x0 - padX) / cols);
  const y = Math.max(0, (best.y0 - padY) / rows);
  const right = Math.min(1, (best.x1 + 1 + padX) / cols);
  const bottom = Math.min(1, (best.y1 + 1 + padY) / rows);
  return { x, y, width: right - x, height: bottom - y };
}

function blobScore(hit: BlobHit | null, cols: number, rows: number) {
  if (!hit) return 0;
  const box = boxFromBlob(hit, cols, rows);
  const headish = box.height >= box.width * 0.82 ? 1.4 : 0.7;
  return hit.score * box.width * box.height * headish;
}

function gridSize(width: number, height: number) {
  const cols = Math.min(96, width);
  const rows = Math.max(8, Math.round((height * cols) / width));
  return { cols, rows };
}

function searchOriented(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  hint?: FaceHint,
): FaceFind | null {
  const up = findInOrientation(rgba, width, height, hint);
  const upGrid = gridSize(width, height);
  const cw = rotate90cw(rgba, width, height);
  const onCw = findInOrientation(cw.rgba, cw.width, cw.height, hint ? rotateHintCw(hint) : undefined);
  const cwGrid = gridSize(cw.width, cw.height);
  const ccw = rotate90ccw(rgba, width, height);
  const onCcw = findInOrientation(
    ccw.rgba,
    ccw.width,
    ccw.height,
    hint ? rotateHintCcw(hint) : undefined,
  );
  const ccwGrid = gridSize(ccw.width, ccw.height);
  const upScore = blobScore(up, upGrid.cols, upGrid.rows);
  const cwScore = blobScore(onCw, cwGrid.cols, cwGrid.rows);
  const ccwScore = blobScore(onCcw, ccwGrid.cols, ccwGrid.rows);
  if (up && upScore >= cwScore && upScore >= ccwScore) {
    const box = boxFromBlob(up, upGrid.cols, upGrid.rows);
    return { box, uprightBox: box, turned: 0 };
  }
  if (onCw && cwScore >= ccwScore) {
    const uprightBox = boxFromBlob(onCw, cwGrid.cols, cwGrid.rows);
    return { box: mapBoxFrom90cw(uprightBox), uprightBox, turned: 90 };
  }
  if (onCcw) {
    const uprightBox = boxFromBlob(onCcw, ccwGrid.cols, ccwGrid.rows);
    return { box: mapBoxFrom90ccw(uprightBox), uprightBox, turned: 270 };
  }
  if (up) {
    const box = boxFromBlob(up, upGrid.cols, upGrid.rows);
    return { box, uprightBox: box, turned: 0 };
  }
  return null;
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
): FaceFind | null {
  const found = searchOriented(rgba, width, height, hint);
  if (found) return found;
  if (!hint) return null;
  const af = faceFromAf(hint);
  if (!af) return null;
  return { box: af, uprightBox: af, turned: 0 };
}

export function cullFaceFromBox(box: PortraitFace, sharpness = -1, eyesOpen: boolean | null = null) {
  return { x: box.x, y: box.y, width: box.width, height: box.height, sharpness, eyesOpen };
}

export function readingHasFace(reading: { hasFace: boolean; faceBox?: unknown }): boolean {
  return reading.hasFace || Boolean(reading.faceBox);
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
