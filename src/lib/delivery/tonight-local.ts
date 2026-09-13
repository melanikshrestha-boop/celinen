import { planTonightGallery, type TonightGalleryPlan } from "@/lib/studio/tonight-gallery";
import { keeperPreviewFile, type CullFrame } from "@/lib/studio/cull-decision";

const DATABASE_NAME = "lenslabs-tonight-gallery";
const DATABASE_VERSION = 1;
const GALLERIES_STORE = "galleries";
const PHOTOS_STORE = "photos";
const SLUG_INDEX = "slug";
const GALLERY_PHOTOS_INDEX = "galleryId";

export type TonightLocalGallery = {
  id: string;
  slug: string;
  title: string;
  passcode: string;
  downloadsEnabled: true;
  createdAt: string;
  keepers: number;
  note: "Originals were not copied, moved, or modified.";
};

export type TonightLocalPhoto = {
  id: string;
  galleryId: string;
  filename: string;
  mimeType: string;
  sortOrder: number;
  blob: Blob;
};

export function createTonightLocalGalleryRecord(
  plan: Pick<TonightGalleryPlan, "title" | "passcode" | "slug" | "keepers">,
  identity: { id?: string; now?: string } = {},
): TonightLocalGallery {
  const title = plan.title.trim();
  if (!title) throw new Error("Give this gallery a name first.");
  const passcode = plan.passcode.trim();
  if (passcode.length < 4) throw new Error("Set a passcode before sending.");
  const slug = plan.slug.trim();
  if (!slug || slug.includes("/") || slug.includes("\\")) throw new Error("Gallery link is missing.");
  const now = identity.now ?? new Date().toISOString();
  return {
    id: identity.id ?? nextId(),
    slug,
    title,
    passcode,
    downloadsEnabled: true,
    createdAt: now,
    keepers: plan.keepers.length,
    note: "Originals were not copied, moved, or modified.",
  };
}

function nextId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("This browser cannot create a gallery ID.");
  }
  return crypto.randomUUID();
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local gallery request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local gallery transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local gallery transaction was cancelled."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Local galleries require browser storage."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(GALLERIES_STORE)) {
        const galleries = database.createObjectStore(GALLERIES_STORE, { keyPath: "id" });
        galleries.createIndex(SLUG_INDEX, "slug", { unique: true });
      }
      if (!database.objectStoreNames.contains(PHOTOS_STORE)) {
        const photos = database.createObjectStore(PHOTOS_STORE, { keyPath: "id" });
        photos.createIndex(GALLERY_PHOTOS_INDEX, "galleryId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open tonight gallery storage."));
    request.onblocked = () => reject(new Error("Close other tabs, then try again."));
  });
}

export async function readTonightGalleryBySlug(
  slug: string,
): Promise<{ gallery: TonightLocalGallery; photos: TonightLocalPhoto[] } | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([GALLERIES_STORE, PHOTOS_STORE], "readonly");
    const done = transactionDone(transaction);
    const galleryRequest = transaction
      .objectStore(GALLERIES_STORE)
      .index(SLUG_INDEX)
      .get(slug) as IDBRequest<TonightLocalGallery | undefined>;
    const gallery = await requestResult(galleryRequest);
    if (!gallery) {
      await done;
      return null;
    }
    const photosRequest = transaction
      .objectStore(PHOTOS_STORE)
      .index(GALLERY_PHOTOS_INDEX)
      .getAll(IDBKeyRange.only(gallery.id)) as IDBRequest<TonightLocalPhoto[]>;
    const photos = await requestResult(photosRequest);
    await done;
    return {
      gallery,
      photos: photos.sort((a, b) => a.sortOrder - b.sortOrder),
    };
  } finally {
    database.close();
  }
}

export async function saveTonightLocalGallery(
  plan: TonightGalleryPlan,
  files: { frame: CullFrame; file: File }[],
): Promise<TonightLocalGallery> {
  if (files.length !== plan.keepers.length)
    throw new Error("Every keeper needs a file before sending.");
  const gallery = createTonightLocalGalleryRecord(plan);
  const photos: TonightLocalPhoto[] = files.map((entry, index) => ({
    id: nextId(),
    galleryId: gallery.id,
    filename: entry.file.name,
    mimeType: entry.file.type || "image/jpeg",
    sortOrder: index,
    blob: entry.file,
  }));
  const database = await openDatabase();
  try {
    const transaction = database.transaction([GALLERIES_STORE, PHOTOS_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(GALLERIES_STORE).add(gallery);
    const photoStore = transaction.objectStore(PHOTOS_STORE);
    for (const photo of photos) photoStore.add(photo);
    await done;
    return gallery;
  } finally {
    database.close();
  }
}

export function tonightKeeperFiles(plan: TonightGalleryPlan): { frame: CullFrame; file: File }[] {
  return plan.keepers.map((frame) => ({ frame, file: keeperPreviewFile(frame) }));
}

export async function sendTonightKeepers(
  frames: readonly CullFrame[],
  title: string,
): Promise<TonightLocalGallery> {
  const plan = planTonightGallery(frames, { title });
  return saveTonightLocalGallery(plan, tonightKeeperFiles(plan));
}
