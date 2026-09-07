/**
 * .lenspack v1: "LENSPACK", little-endian uint32 version and manifest length,
 * a UTF-8 JSON envelope, then the declared blobs in manifest order. No ZIP,
 * compression, filenames, executable metadata, or filesystem paths are involved.
 */
const MAGIC = new TextEncoder().encode("LENSPACK");
const VERSION = 1;
const FORMAT = "lenslabs-project-archive";
const HEADER_BYTES = 16;
export const PROJECT_ARCHIVE_MIME = "application/vnd.lenslabs.project";
export const PROJECT_ARCHIVE_LIMITS = {
  archiveBytes: 256 * 1024 * 1024,
  manifestBytes: 16 * 1024 * 1024,
  blobBytes: 128 * 1024 * 1024,
  blobCount: 20_000,
} as const;

type BlobDescriptor = { id: string; size: number; type: string };
type Envelope = {
  format: typeof FORMAT;
  version: typeof VERSION;
  document: unknown;
  blobs: BlobDescriptor[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function checkBlob(blob: Blob): void {
  if (!(blob instanceof Blob)) throw new Error("A source blob is missing or invalid.");
  if (
    !Number.isSafeInteger(blob.size) ||
    blob.size < 0 ||
    blob.size > PROJECT_ARCHIVE_LIMITS.blobBytes
  )
    throw new Error("A source blob exceeds the 128 MiB limit or has an invalid size.");
  if (blob.type.length > 255 || !/^[ -~]*$/.test(blob.type))
    throw new Error("A source blob has an invalid media type.");
}

/** Inspect data properties before serialization so metadata cannot run getters or toJSON hooks. */
function checkJSONDocument(value: unknown, parents = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || parents.has(value)) throw new Error("Non-JSON value");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
    throw new Error("Non-JSON object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const serializer = descriptors["toJSON"];
  if (serializer && (!("value" in serializer) || typeof serializer.value === "function"))
    throw new Error("Executable serializer");
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error("Sparse or decorated array");
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index)) throw new Error("Sparse array");
    }
  }
  parents.add(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) throw new Error("Executable property");
    checkJSONDocument(descriptor.value, parents);
  }
  parents.delete(value);
}

/** Hash at most one bounded source at a time; callers should not parallelize a whole shoot. */
export async function hashBlob(blob: Blob): Promise<string> {
  checkBlob(blob);
  if (typeof crypto === "undefined" || !crypto.subtle)
    throw new Error("Secure hashing is unavailable in this browser.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createProjectArchive(
  document: unknown,
  blobs: ReadonlyMap<string, Blob>,
): Promise<Blob> {
  if (blobs.size > PROJECT_ARCHIVE_LIMITS.blobCount)
    throw new Error("A lenspack can contain at most 20,000 blobs.");

  const descriptors: BlobDescriptor[] = [];
  const sources: Blob[] = [];
  const seen = new Set<string>();
  let sourceBytes = 0;
  for (const [id, blob] of blobs) {
    if (!isHash(id)) throw new Error("Every blob ID must be a lowercase SHA-256 hash.");
    if (seen.has(id)) throw new Error("Duplicate blob IDs are not allowed.");
    seen.add(id);
    checkBlob(blob);
    sourceBytes += blob.size;
    if (sourceBytes > PROJECT_ARCHIVE_LIMITS.archiveBytes)
      throw new Error("This project exceeds the 256 MiB lenspack limit.");
    descriptors.push({ id, size: blob.size, type: blob.type });
    sources.push(blob);
  }

  let json: string;
  try {
    checkJSONDocument(document);
    json = JSON.stringify(
      { format: FORMAT, version: VERSION, document, blobs: descriptors },
      (_key, value: unknown) => {
        if (
          value === undefined ||
          typeof value === "function" ||
          typeof value === "symbol" ||
          typeof value === "bigint" ||
          (typeof value === "number" && !Number.isFinite(value))
        )
          throw new Error("Non-JSON value");
        return value;
      },
    );
  } catch {
    throw new Error("The project document must contain only finite, serializable JSON values.");
  }
  const manifest = new TextEncoder().encode(json);
  if (manifest.byteLength > PROJECT_ARCHIVE_LIMITS.manifestBytes)
    throw new Error("The lenspack manifest exceeds the 16 MiB limit.");
  if (HEADER_BYTES + manifest.byteLength + sourceBytes > PROJECT_ARCHIVE_LIMITS.archiveBytes)
    throw new Error("This project exceeds the 256 MiB lenspack limit.");

  // All limits are checked before reading source bytes. Hash sequentially to
  // avoid keeping thousands of source ArrayBuffers alive during an export.
  for (let index = 0; index < sources.length; index++) {
    if ((await hashBlob(sources[index]!)) !== descriptors[index]!.id)
      throw new Error("A source blob's bytes do not match its SHA-256 ID.");
  }
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint32(8, VERSION, true);
  view.setUint32(12, manifest.byteLength, true);
  return new Blob([header, manifest, ...sources], { type: PROJECT_ARCHIVE_MIME });
}

function readEnvelope(value: unknown): Envelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["format", "version", "document", "blobs"]) ||
    value["format"] !== FORMAT ||
    value["version"] !== VERSION ||
    !Array.isArray(value["blobs"])
  )
    throw new Error("The lenspack manifest has an unsupported or invalid schema.");
  if (value["blobs"].length > PROJECT_ARCHIVE_LIMITS.blobCount)
    throw new Error("A lenspack can contain at most 20,000 blobs.");
  const seen = new Set<string>();
  for (const descriptor of value["blobs"]) {
    if (
      !isRecord(descriptor) ||
      !hasExactKeys(descriptor, ["id", "size", "type"]) ||
      !isHash(descriptor["id"]) ||
      !Number.isSafeInteger(descriptor["size"]) ||
      Number(descriptor["size"]) < 0 ||
      Number(descriptor["size"]) > PROJECT_ARCHIVE_LIMITS.blobBytes ||
      typeof descriptor["type"] !== "string" ||
      descriptor["type"].length > 255 ||
      !/^[ -~]*$/.test(descriptor["type"])
    )
      throw new Error("The lenspack contains an invalid blob descriptor.");
    if (seen.has(descriptor["id"])) throw new Error("The lenspack contains duplicate blob IDs.");
    seen.add(descriptor["id"]);
  }
  return value as unknown as Envelope;
}

/** Validate every byte before returning; callers must validate project-domain references before committing. */
export async function parseProjectArchive(
  file: Blob,
): Promise<{ document: unknown; blobs: Map<string, Blob> }> {
  if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size < HEADER_BYTES)
    throw new Error("The lenspack header is missing or truncated.");
  if (file.size > PROJECT_ARCHIVE_LIMITS.archiveBytes)
    throw new Error("The lenspack exceeds the 256 MiB limit.");

  const header = await file.slice(0, HEADER_BYTES).arrayBuffer();
  const bytes = new Uint8Array(header);
  if (!MAGIC.every((byte, index) => bytes[index] === byte))
    throw new Error("This file is not a lenspack archive.");
  const view = new DataView(header);
  if (view.getUint32(8, true) !== VERSION)
    throw new Error("This lenspack version is not supported.");
  const manifestLength = view.getUint32(12, true);
  if (manifestLength === 0 || manifestLength > PROJECT_ARCHIVE_LIMITS.manifestBytes)
    throw new Error("The lenspack manifest length is invalid or exceeds 16 MiB.");
  const payloadOffset = HEADER_BYTES + manifestLength;
  if (payloadOffset > file.size) throw new Error("The lenspack manifest is truncated.");
  let parsed: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.slice(HEADER_BYTES, payloadOffset).arrayBuffer(),
    );
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The lenspack manifest contains invalid JSON or UTF-8.");
  }
  const envelope = readEnvelope(parsed);
  const expectedSize = envelope.blobs.reduce((size, blob) => size + blob.size, payloadOffset);
  if (!Number.isSafeInteger(expectedSize) || expectedSize > PROJECT_ARCHIVE_LIMITS.archiveBytes)
    throw new Error("The declared lenspack content exceeds the 256 MiB limit.");
  if (expectedSize > file.size)
    throw new Error("The lenspack is truncated or a source blob is missing.");
  if (expectedSize < file.size) throw new Error("The lenspack contains unexpected trailing bytes.");

  const blobs = new Map<string, Blob>();
  let offset = payloadOffset;
  for (const descriptor of envelope.blobs) {
    const blob = file.slice(offset, offset + descriptor.size, descriptor.type);
    if ((await hashBlob(blob)) !== descriptor.id)
      throw new Error("The lenspack contains corrupted blob bytes or a mismatched SHA-256 ID.");
    blobs.set(descriptor.id, blob);
    offset += descriptor.size;
  }
  return { document: envelope.document, blobs };
}
