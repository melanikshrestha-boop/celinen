/** GIDX/GOUT v1: C++ gallery hearts index. Same-night favorites stay ordered and fast. */
export const GALLERY_INDEX_MAX_ITEMS = 200_000;
export const GALLERY_INDEX_MAX_ID = 80;
export const GALLERY_INDEX_MAX_NAME = 255;
const REQUEST_MAGIC = 0x47494458;
const RESULT_MAGIC = 0x474f5554;
const VERSION = 1;

export type GalleryIndexPhoto = { id: string; name: string };
export type GalleryIndexRequest = {
  photos: GalleryIndexPhoto[];
  hearts: string[];
  edited: string[];
};
export type GalleryIndexResult = {
  favorites: string[];
  matches: { photoId: string; editedName: string }[];
  missing: string[];
};

export function galleryStem(name: string) {
  if (!name || name.length > GALLERY_INDEX_MAX_NAME) throw new Error("Gallery filename is invalid.");
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot <= 0 ? lower : lower.slice(0, dot);
}

function put32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value);
  return offset + 4;
}
function put16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value);
  return offset + 2;
}

export function encodeGalleryIndex(request: GalleryIndexRequest): Uint8Array {
  if (
    request.photos.length > GALLERY_INDEX_MAX_ITEMS ||
    request.hearts.length > GALLERY_INDEX_MAX_ITEMS ||
    request.edited.length > GALLERY_INDEX_MAX_ITEMS
  )
    throw new Error("Gallery index exceeds limits.");
  const encoder = new TextEncoder();
  const texts: Uint8Array[] = [];
  let size = 20;
  const push = (value: string, max: number) => {
    if (!value || value.length > max) throw new Error("Gallery field is empty or too long.");
    const bytes = encoder.encode(value);
    if (bytes.length > max) throw new Error("Gallery field is empty or too long.");
    texts.push(bytes);
    size += 2 + bytes.length;
  };
  for (const photo of request.photos) {
    push(photo.id, GALLERY_INDEX_MAX_ID);
    push(photo.name, GALLERY_INDEX_MAX_NAME);
  }
  for (const id of request.hearts) push(id, GALLERY_INDEX_MAX_ID);
  for (const name of request.edited) push(name, GALLERY_INDEX_MAX_NAME);
  const packet = new Uint8Array(size);
  const view = new DataView(packet.buffer);
  let offset = put32(view, 0, REQUEST_MAGIC);
  offset = put32(view, offset, VERSION);
  offset = put32(view, offset, request.photos.length);
  let text = 0;
  const writeText = () => {
    const bytes = texts[text++]!;
    offset = put16(view, offset, bytes.length);
    packet.set(bytes, offset);
    offset += bytes.length;
  };
  for (const photo of request.photos) {
    void photo;
    writeText();
    writeText();
  }
  offset = put32(view, offset, request.hearts.length);
  for (const id of request.hearts) {
    void id;
    writeText();
  }
  offset = put32(view, offset, request.edited.length);
  for (const name of request.edited) {
    void name;
    writeText();
  }
  return packet;
}

export function indexGalleryHeartsLocal(request: GalleryIndexRequest): GalleryIndexResult {
  const hearts = new Set(request.hearts);
  const editedByStem = new Map<string, string>();
  for (const name of request.edited) {
    const key = galleryStem(name);
    if (!editedByStem.has(key)) editedByStem.set(key, name);
  }
  const favorites: string[] = [];
  const matches: { photoId: string; editedName: string }[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const photo of request.photos) {
    if (!hearts.has(photo.id) || seen.has(photo.id)) continue;
    seen.add(photo.id);
    favorites.push(photo.id);
    const edited = editedByStem.get(galleryStem(photo.name));
    if (edited) matches.push({ photoId: photo.id, editedName: edited });
    else missing.push(photo.id);
  }
  return { favorites, matches, missing };
}

export function decodeGalleryIndex(bytes: Uint8Array): GalleryIndexResult {
  if (bytes.length < 16) throw new Error("Gallery result is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== RESULT_MAGIC || view.getUint32(4) !== VERSION)
    throw new Error("Gallery result magic is invalid.");
  const decoder = new TextDecoder();
  let offset = 8;
  const readText = (max: number) => {
    if (offset + 2 > bytes.length) throw new Error("Gallery result is truncated.");
    const length = view.getUint16(offset);
    offset += 2;
    if (!length || length > max || offset + length > bytes.length)
      throw new Error("Gallery result field is invalid.");
    const text = decoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return text;
  };
  const favorites: string[] = [];
  const favCount = view.getUint32(offset);
  offset += 4;
  for (let i = 0; i < favCount; i++) favorites.push(readText(GALLERY_INDEX_MAX_ID));
  const matches: { photoId: string; editedName: string }[] = [];
  const matchCount = view.getUint32(offset);
  offset += 4;
  for (let i = 0; i < matchCount; i++)
    matches.push({ photoId: readText(GALLERY_INDEX_MAX_ID), editedName: readText(GALLERY_INDEX_MAX_NAME) });
  const missing: string[] = [];
  const missingCount = view.getUint32(offset);
  offset += 4;
  for (let i = 0; i < missingCount; i++) missing.push(readText(GALLERY_INDEX_MAX_ID));
  if (offset !== bytes.length) throw new Error("Gallery result has trailing bytes.");
  return { favorites, matches, missing };
}

export async function indexGalleryHearts(request: GalleryIndexRequest): Promise<GalleryIndexResult> {
  if (typeof fetch === "undefined") return indexGalleryHeartsLocal(request);
  try {
    const status = await fetch("/__native/gallery-index/status");
    if (!status.ok) return indexGalleryHeartsLocal(request);
    const body = (await status.json()) as { ready?: boolean };
    if (!body.ready) return indexGalleryHeartsLocal(request);
    const response = await fetch("/__native/gallery-index", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: encodeGalleryIndex(request),
    });
    if (!response.ok) return indexGalleryHeartsLocal(request);
    return decodeGalleryIndex(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return indexGalleryHeartsLocal(request);
  }
}
