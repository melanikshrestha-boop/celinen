/** A Sony-shaped RAW built byte by byte, with a known camera inside it.
 *
 * The same construction as native/tests/raw_decode_tests.cpp: a synthetic
 * camera whose response is physically possible (every entry of camera->XYZ is
 * non-negative, so no channel absorbs light), a mosaic of flat colour blocks
 * put through it, and a real TIFF container carrying the DNG colour tags. That
 * gives the WebAssembly tests a truth to measure against without shipping a
 * photograph into the repository.
 */

type Matrix = number[]; // row major 3x3
type Vector = [number, number, number];

// The exact white of the sRGB matrix, matching native/include/lenslabs/raw_color.hpp.
const D65_XYZ: Vector = [
  0.312699988817 / 0.328999997598,
  1,
  (1 - 0.312699988817 - 0.328999997598) / 0.328999997598,
];

const SRGB_TO_XYZ: Matrix = [
  0.4123908, 0.3575843, 0.1804808, 0.212639, 0.7151687, 0.0721923, 0.0193308, 0.1191948, 0.9505322,
];

function multiplyVector(m: Matrix, v: Vector): Vector {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

function invert(m: Matrix): Matrix {
  const det =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const s = 1 / det;
  return [
    s * (m[4]! * m[8]! - m[5]! * m[7]!),
    s * (m[2]! * m[7]! - m[1]! * m[8]!),
    s * (m[1]! * m[5]! - m[2]! * m[4]!),
    s * (m[5]! * m[6]! - m[3]! * m[8]!),
    s * (m[0]! * m[8]! - m[2]! * m[6]!),
    s * (m[2]! * m[3]! - m[0]! * m[5]!),
    s * (m[3]! * m[7]! - m[4]! * m[6]!),
    s * (m[1]! * m[6]! - m[0]! * m[7]!),
    s * (m[0]! * m[4]! - m[1]! * m[3]!),
  ];
}

const BASE: Matrix = [0.31, 0.52, 0.12, 0.14, 0.8, 0.06, 0.01, 0.1, 0.98];
// Per-channel sensitivity, so the file carries a real white balance to undo.
const SENSITIVITY: Vector = [2.0, 1.0, 1.25];

function cameraToXyz(): Matrix {
  const balanced = multiplyVector(invert(BASE), D65_XYZ);
  const out: Matrix = new Array(9).fill(0);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      out[row * 3 + column] = (BASE[row * 3 + column]! * balanced[column]!) / SENSITIVITY[column]!;
  return out;
}

// --- a little-endian TIFF writer ------------------------------------------

type Field = { tag: number; type: number; count: number; payload?: Uint8Array; inline?: number };

function shortField(tag: number, value: number): Field {
  return { tag, type: 3, count: 1, inline: value };
}
function longField(tag: number, value: number): Field {
  return { tag, type: 4, count: 1, inline: value };
}
function shortsField(tag: number, values: number[]): Field {
  if (values.length <= 2) {
    let packed = 0;
    values.forEach((v, i) => (packed |= v << (16 * i)));
    return { tag, type: 3, count: values.length, inline: packed >>> 0 };
  }
  const payload = new Uint8Array(values.length * 2);
  const view = new DataView(payload.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v, true));
  return { tag, type: 3, count: values.length, payload };
}
function longsField(tag: number, values: number[]): Field {
  if (values.length === 1) return { tag, type: 4, count: 1, inline: values[0]! };
  const payload = new Uint8Array(values.length * 4);
  const view = new DataView(payload.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  return { tag, type: 4, count: values.length, payload };
}
function bytesField(tag: number, values: number[]): Field {
  if (values.length <= 4) {
    let packed = 0;
    values.forEach((v, i) => (packed |= v << (8 * i)));
    return { tag, type: 1, count: values.length, inline: packed >>> 0 };
  }
  return { tag, type: 1, count: values.length, payload: Uint8Array.from(values) };
}
function textField(tag: number, value: string): Field {
  const bytes = Uint8Array.from([...value].map((c) => c.charCodeAt(0)).concat(0));
  if (bytes.length <= 4) {
    let packed = 0;
    bytes.forEach((v, i) => (packed |= v << (8 * i)));
    return { tag, type: 2, count: bytes.length, inline: packed >>> 0 };
  }
  return { tag, type: 2, count: bytes.length, payload: bytes };
}
function rationalsField(tag: number, values: number[], signed: boolean): Field {
  const payload = new Uint8Array(values.length * 8);
  const view = new DataView(payload.buffer);
  const denominator = 1000000;
  values.forEach((v, i) => {
    if (signed) {
      view.setInt32(i * 8, Math.round(v * denominator), true);
      view.setInt32(i * 8 + 4, denominator, true);
    } else {
      view.setUint32(i * 8, Math.round(Math.max(0, v) * denominator), true);
      view.setUint32(i * 8 + 4, denominator, true);
    }
  });
  return { tag, type: signed ? 10 : 5, count: values.length, payload };
}

function buildTiff(ifd0: Field[], sub: Field[], strip: Uint8Array): Uint8Array {
  const ifd0At = 8;
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const subAt = ifd0At + ifd0Size;
  const subSize = 2 + sub.length * 12 + 4;
  let cursor = subAt + subSize;
  const offsetOf = (fields: Field[]) =>
    fields.map((field) => {
      const at = cursor;
      if (field.payload) cursor += (field.payload.length + 1) & ~1;
      return at;
    });
  const ifd0Offsets = offsetOf(ifd0);
  const subOffsets = offsetOf(sub);
  const stripAt = cursor;
  const total = stripAt + strip.length;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0At, true);

  const emit = (fields: Field[], offsets: number[], at: number) => {
    view.setUint16(at, fields.length, true);
    fields.forEach((field, index) => {
      const entry = at + 2 + index * 12;
      view.setUint16(entry, field.tag, true);
      view.setUint16(entry + 2, field.type, true);
      view.setUint32(entry + 4, field.count, true);
      // Two placeholders resolve late: SubIFDs and StripOffsets.
      const value =
        field.tag === 330 ? subAt : field.tag === 273 ? stripAt : (field.inline ?? offsets[index]!);
      if (field.payload) {
        out.set(field.payload, offsets[index]!);
        view.setUint32(entry + 8, offsets[index]!, true);
      } else {
        // A value of four bytes or fewer lives in the field itself.
        view.setUint32(entry + 8, value >>> 0, true);
      }
    });
    view.setUint32(at + 2 + fields.length * 12, 0, true);
  };
  emit(ifd0, ifd0Offsets, ifd0At);
  emit(sub, subOffsets, subAt);
  out.set(strip, stripAt);
  return out;
}

export type SyntheticArw = {
  file: Uint8Array;
  picture: { width: number; height: number };
  colours: Vector[];
  block: number;
  columns: number;
  /** The camera's own neutral, green normalised to 1. */
  neutral: Vector;
};

/**
 * @param options.colourTags false writes a file with no colour information at
 * all and a model no table knows, which the decoder must refuse by name.
 */
export function buildSyntheticArw(options: { colourTags?: boolean } = {}): SyntheticArw {
  const colourTags = options.colourTags !== false;
  const colours: Vector[] = [
    [0.18, 0.18, 0.18],
    [0.6, 0.6, 0.6],
    [0.05, 0.05, 0.05],
    [0.45, 0.12, 0.1],
    [0.12, 0.4, 0.14],
    [0.09, 0.14, 0.45],
    [0.55, 0.45, 0.1],
    [0.4, 0.1, 0.35],
    [0.1, 0.38, 0.42],
    [0.3, 0.25, 0.18],
    [0.22, 0.3, 0.2],
    [0.35, 0.2, 0.25],
  ];
  const block = 24,
    columns = 4;
  const rows = Math.ceil(colours.length / columns);
  const cropWidth = columns * block,
    cropHeight = rows * block;
  const margin = 8; // a masked border, so the crop is not the whole raster
  const rawWidth = cropWidth + margin * 2,
    rawHeight = cropHeight + margin * 2;
  const white = 16383,
    black = 512,
    headroom = 4;
  const span = white - black;

  const matrix = cameraToXyz();
  const toCamera = invert(matrix);
  const neutral: Vector = [
    SENSITIVITY[0] / SENSITIVITY[1],
    1,
    SENSITIVITY[2] / SENSITIVITY[1],
  ];

  const samples = new Uint16Array(rawWidth * rawHeight).fill(black);
  colours.forEach((colour, index) => {
    const camera = multiplyVector(toCamera, multiplyVector(SRGB_TO_XYZ, colour));
    const bx = (index % columns) * block + margin;
    const by = Math.floor(index / columns) * block + margin;
    for (let y = 0; y < block; y++)
      for (let x = 0; x < block; x++) {
        // RGGB at the raster origin; the margin is even so the crop keeps phase.
        const channel = (by + y) % 2 === 0 ? ((bx + x) % 2 === 0 ? 0 : 1) : (bx + x) % 2 === 0 ? 1 : 2;
        const value = camera[channel]! / headroom;
        samples[(by + y) * rawWidth + bx + x] = Math.max(
          0,
          Math.min(white, Math.round(black + value * span)),
        );
      }
  });
  const strip = new Uint8Array(samples.length * 2);
  const stripView = new DataView(strip.buffer);
  samples.forEach((v, i) => stripView.setUint16(i * 2, v, true));

  const colourMatrix = invert(matrix);
  const ifd0: Field[] = [
    textField(271, colourTags ? "FIXTURE" : "NOBODY"),
    textField(272, colourTags ? "SYNTHETIC-1" : "UNPROFILED-1"),
    shortField(274, 1),
    longField(330, 0),
  ];
  if (colourTags) {
    ifd0.push(rationalsField(50721, colourMatrix, true));
    ifd0.push(shortField(50778, 21)); // D65
    ifd0.push(rationalsField(50728, neutral, false));
  }
  const sub: Field[] = [
    longField(254, 0),
    shortsField(256, [rawWidth]),
    shortsField(257, [rawHeight]),
    shortField(258, 14),
    shortField(259, 1),
    shortField(262, 32803),
    longField(273, 0),
    shortField(277, 1),
    shortsField(278, [rawHeight]),
    longField(279, strip.length),
    shortsField(33421, [2, 2]),
    bytesField(33422, [0, 1, 1, 2]),
    shortsField(50714, [black]),
    shortsField(50717, [white]),
    longsField(0xc61f, [margin, margin]),
    longsField(0xc620, [cropWidth, cropHeight]),
  ];

  return {
    file: buildTiff(ifd0, sub, strip),
    picture: { width: cropWidth, height: cropHeight },
    colours,
    block,
    columns,
    neutral,
  };
}
