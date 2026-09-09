export const REMOVE_MAX_EDGE = 4096;
export const REMOVE_ANALYSIS_EDGE = 1600;
export const REMOVE_MAX_BYTES = 16 + REMOVE_MAX_EDGE * REMOVE_MAX_EDGE * 5;
/** Removal creates its own bounded rendered copy; never changes the editor/export size. */
export function removalRenderEdge(exportEdge: number) {
  if (!Number.isSafeInteger(exportEdge) || exportEdge < 32)
    throw new Error("Invalid removal render size.");
  return Math.min(REMOVE_MAX_EDGE, exportEdge);
}
export type ObjectInstances = { width: number; height: number; labels: Uint8Array };
export function encodeRemovePixels(
  image: { width: number; height: number; data: ArrayLike<number> },
  mask?: Uint8Array,
) {
  const { width, height, data } = image;
  const limit = mask ? REMOVE_MAX_EDGE : REMOVE_ANALYSIS_EDGE;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > limit ||
    height > limit ||
    data.length !== width * height * 4 ||
    (mask && mask.length !== width * height)
  )
    throw new Error("Invalid removal image or selection.");
  const bytes = new Uint8Array(16 + data.length + (mask?.length ?? 0));
  const header = new DataView(bytes.buffer);
  [0x464f5231, mask ? 1 : 0, width, height].forEach((value, i) => header.setUint32(i * 4, value));
  bytes.set(data, 16);
  if (mask) bytes.set(mask, 16 + data.length);
  return bytes;
}
export function decodeObjectInstances(bytes: Uint8Array): ObjectInstances {
  if (bytes.length < 12) throw new Error("Incomplete object selection result.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(4),
    height = header.getUint32(8);
  if (
    header.getUint32(0) !== 0x464f4d31 ||
    width < 1 ||
    height < 1 ||
    width > 2048 ||
    height > 2048 ||
    bytes.length !== 12 + width * height
  )
    throw new Error("Invalid object selection result.");
  return { width, height, labels: new Uint8Array(bytes.subarray(12)) };
}
/** Coordinates come from the displayed image rectangle, not the surrounding stage. */
export function objectAtPoint(instances: ObjectInstances, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return 0;
  return (
    instances.labels[
      Math.min(instances.height - 1, Math.floor(y * instances.height)) * instances.width +
        Math.min(instances.width - 1, Math.floor(x * instances.width))
    ] ?? 0
  );
}
export function objectSelectionMask(
  instances: ObjectInstances,
  selected: readonly number[],
  width: number,
  height: number,
  padding = 2,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > REMOVE_MAX_EDGE ||
    height > REMOVE_MAX_EDGE ||
    !Number.isInteger(padding) ||
    padding < 0 ||
    padding > 8
  )
    throw new Error("Invalid selection dimensions.");
  const ids = new Set(selected.filter((id) => Number.isInteger(id) && id > 0 && id < 256));
  const raw = new Uint8Array(width * height),
    mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      raw[y * width + x] = ids.has(objectAtPoint(instances, (x + 0.5) / width, (y + 0.5) / height))
        ? 255
        : 0;
  // Small context margin includes antialiased object edges, never a guessed enclosing box.
  const horizontal = new Uint8Array(raw.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -padding; x < width; x++) {
      if (x + padding < width) sum += raw[y * width + x + padding]!;
      if (x - padding - 1 >= 0) sum -= raw[y * width + x - padding - 1]!;
      if (x >= 0) horizontal[y * width + x] = sum ? 255 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -padding; y < height; y++) {
      if (y + padding < height) sum += horizontal[(y + padding) * width + x]!;
      if (y - padding - 1 >= 0) sum -= horizontal[(y - padding - 1) * width + x]!;
      if (y >= 0) mask[y * width + x] = sum ? 255 : 0;
    }
  }
  return mask;
}
async function removeRequest(packet: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  signal.throwIfAborted();
  if (
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
    throw new Error("Object removal requires the local C++ engine.");
  signal = AbortSignal.any([signal, AbortSignal.timeout(75_000)]);
  const statusResponse = await fetch("/__remove/status", {
    signal,
    credentials: "same-origin",
    headers: { "x-lenslabs-request": "studio" },
    cache: "no-store",
  });
  if (!statusResponse.ok) throw new Error("Local object removal is unavailable.");
  const status = await statusResponse.json();
  if (
    status.ready !== true ||
    typeof status.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(status.token)
  )
    throw new Error("Local object removal requires the macOS C++ engine.");
  const response = await fetch("/__remove/process", {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: {
      "Content-Type": "application/x-foto-remove",
      "x-lenslabs-token": status.token,
      "x-lenslabs-request": "studio",
    },
    body: new Blob([packet]),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.error === "string" ? error.error : "Removal could not finish. Nothing changed.",
    );
  }
  const limit = packet[7] === 0 ? 12 + 2048 * 2048 : 96 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > limit)
    throw new Error("Removal result exceeds limits.");
  const blob = await response.blob();
  if (blob.size > limit) throw new Error("Removal result exceeds limits.");
  signal.throwIfAborted();
  return blob;
}
export async function findPhotoObjects(image: ImageData, signal: AbortSignal) {
  const blob = await removeRequest(encodeRemovePixels(image), signal);
  return decodeObjectInstances(new Uint8Array(await blob.arrayBuffer()));
}
export async function removePhotoObjects(image: ImageData, mask: Uint8Array, signal: AbortSignal) {
  if (!mask.some(Boolean)) throw new Error("Click an object to select it first.");
  const blob = await removeRequest(encodeRemovePixels(image, mask), signal);
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (signature.join(",") !== "137,80,78,71,13,10,26,10")
    throw new Error("Invalid removal preview.");
  return new Blob([blob], { type: "image/png" });
}
