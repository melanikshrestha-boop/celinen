/** Original synthetic uncompressed Bayer DNG. No camera JPEG or embedded thumbnail.
 * Exercises sensor unpack/demosaic/WB/orientation independently of private photos.
 */
export function generatedBayerDng(
  options: { orientation?: number; width?: number; height?: number } = {},
): Buffer {
  const width = options.width ?? 128,
    height = options.height ?? 96;
  const short = (...values: number[]) => {
    const b = Buffer.alloc(values.length * 2);
    values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
    return b;
  };
  const long = (...values: number[]) => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
    return b;
  };
  const rational = (pairs: number[][]) => {
    const b = Buffer.alloc(pairs.length * 8);
    pairs.forEach(([n, d], i) => {
      b.writeInt32LE(n!, i * 8);
      b.writeInt32LE(d!, i * 8 + 4);
    });
    return b;
  };
  const ascii = (text: string) => Buffer.from(text + "\0");
  const tags: Array<{ tag: number; type: number; count: number; bytes: Buffer }> = [];
  const entry = (tag: number, type: number, count: number, bytes: Buffer) =>
    tags.push({ tag, type, count, bytes });
  entry(254, 4, 1, long(0));
  entry(256, 4, 1, long(width));
  entry(257, 4, 1, long(height));
  entry(258, 3, 1, short(16));
  entry(259, 3, 1, short(1));
  entry(262, 3, 1, short(32803));
  entry(271, 2, 5, ascii("FOTO"));
  entry(272, 2, 11, ascii("Bayer Test"));
  entry(273, 4, 1, long(0));
  entry(274, 3, 1, short(options.orientation ?? 1));
  entry(277, 3, 1, short(1));
  entry(278, 4, 1, long(height));
  entry(279, 4, 1, long(width * height * 2));
  entry(284, 3, 1, short(1));
  entry(33421, 3, 2, short(2, 2));
  entry(33422, 1, 4, Buffer.from([0, 1, 1, 2]));
  entry(50706, 1, 4, Buffer.from([1, 4, 0, 0]));
  entry(50707, 1, 4, Buffer.from([1, 3, 0, 0]));
  const model = ascii("FOTO Synthetic Bayer");
  entry(50708, 2, model.length, model);
  entry(50710, 1, 3, Buffer.from([0, 1, 2]));
  entry(50711, 3, 1, short(1));
  entry(50713, 3, 2, short(1, 1));
  entry(50714, 3, 1, short(64));
  entry(50717, 4, 1, long(4095));
  entry(
    50721,
    10,
    9,
    rational([
      [1, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [1, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [1, 1],
    ]),
  );
  entry(
    50728,
    5,
    3,
    rational([
      [1, 2],
      [1, 1],
      [2, 3],
    ]),
  );
  entry(50778, 3, 1, short(21));
  tags.sort((a, b) => a.tag - b.tag);
  let payload = 8 + 2 + tags.length * 12 + 4;
  const entries = tags.map((tag) => {
    const offset = tag.bytes.length > 4 ? payload : 0;
    if (offset) payload += tag.bytes.length + (tag.bytes.length % 2);
    return { ...tag, offset };
  });
  const output = Buffer.alloc(payload + width * height * 2);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(8, 4);
  output.writeUInt16LE(tags.length, 8);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!,
      at = 10 + i * 12;
    output.writeUInt16LE(e.tag, at);
    output.writeUInt16LE(e.type, at + 2);
    output.writeUInt32LE(e.count, at + 4);
    if (e.tag === 273) output.writeUInt32LE(payload, at + 8);
    else if (e.offset) {
      output.writeUInt32LE(e.offset, at + 8);
      e.bytes.copy(output, e.offset);
    } else e.bytes.copy(output, at + 8);
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = y % 2 === 0 ? (x % 2 === 0 ? 0 : 1) : x % 2 === 0 ? 1 : 2;
      const bands = [
        400 + (1500 * x) / width,
        600 + (1300 * y) / height,
        800 + (900 * (x + y)) / (width + height),
      ];
      output.writeUInt16LE(Math.round(bands[color]! + 64), payload + (y * width + x) * 2);
    }
  return output;
}
