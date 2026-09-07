const DATABASE_NAME = "lenslabs-local-delivery";
const DATABASE_VERSION = 2;
const GALLERIES_STORE = "galleries";
const PHOTOS_STORE = "photos";
const GALLERY_PHOTOS_INDEX = "galleryId";
const GALLERY_PHOTO_ORDER_INDEX = "galleryId-sortOrder";
const PREVIEW_MAX_EDGE = 720;
const PREVIEW_QUALITY = 0.76;

export type LocalDeliveryGallery = {
  id: string;
  title: string;
  message: string | null;
  downloadsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalDeliveryGallerySummary = LocalDeliveryGallery & {
  photoCount: number;
};

export type LocalDeliveryPhoto = {
  id: string;
  galleryId: string;
  filename: string;
  mimeType: string;
  size: number;
  lastModified: number;
  width: number;
  height: number;
  sortOrder: number;
  previewBlob: Blob;
  createdAt: string;
};

export type LocalDeliveryPhotoDraft = Pick<
  LocalDeliveryPhoto,
  "filename" | "mimeType" | "size" | "lastModified" | "width" | "height" | "previewBlob"
>;

export type LocalDeliveryManifest = {
  version: 1;
  kind: "lenslabs-local-gallery-draft";
  scope: "local-only";
  exportedAt: string;
  gallery: {
    title: string;
    message: string | null;
    downloadsWhenPublished: boolean;
    createdAt: string;
    updatedAt: string;
  };
  files: Array<{
    filename: string;
    mimeType: string;
    size: number;
    lastModified: number;
    width: number;
    height: number;
    sortOrder: number;
  }>;
  note: "Planning manifest only. No files were uploaded and no gallery was published.";
};

type GalleryInput = {
  title: string;
  message?: string | null;
};

type GalleryRecordIdentity = {
  id?: string;
  now?: string;
};

type GalleryUpdate = Partial<Pick<LocalDeliveryGallery, "title" | "message" | "downloadsEnabled">>;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local storage transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local storage transaction was cancelled."));
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
        database.createObjectStore(GALLERIES_STORE, { keyPath: "id" });
      }

      const photos = database.objectStoreNames.contains(PHOTOS_STORE)
        ? request.transaction?.objectStore(PHOTOS_STORE)
        : database.createObjectStore(PHOTOS_STORE, { keyPath: "id" });
      if (photos && !photos.indexNames.contains(GALLERY_PHOTOS_INDEX)) {
        photos.createIndex(GALLERY_PHOTOS_INDEX, "galleryId", { unique: false });
      }
      if (photos && !photos.indexNames.contains(GALLERY_PHOTO_ORDER_INDEX)) {
        photos.createIndex(GALLERY_PHOTO_ORDER_INDEX, ["galleryId", "sortOrder"], {
          unique: false,
        });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local gallery storage."));
    request.onblocked = () => reject(new Error("Close other LensLabs tabs, then try again."));
  });
}

function normalizedMessage(message: string | null | undefined): string | null {
  const value = message?.trim() ?? "";
  return value || null;
}

function nextId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("This browser cannot create a local gallery ID.");
  }
  return crypto.randomUUID();
}

export function createLocalDeliveryGalleryRecord(
  input: GalleryInput,
  identity: GalleryRecordIdentity = {},
): LocalDeliveryGallery {
  const title = input.title.trim();
  if (!title) throw new Error("Give this gallery a name first.");

  const now = identity.now ?? new Date().toISOString();
  return {
    id: identity.id ?? nextId(),
    title,
    message: normalizedMessage(input.message),
    downloadsEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listLocalDeliveryGalleries(): Promise<LocalDeliveryGallerySummary[]> {
  const database = await openDatabase();
  try {
    const galleriesTransaction = database.transaction(GALLERIES_STORE, "readonly");
    const galleriesDone = transactionDone(galleriesTransaction);
    const galleriesRequest = galleriesTransaction
      .objectStore(GALLERIES_STORE)
      .getAll() as IDBRequest<LocalDeliveryGallery[]>;
    const galleries = await requestResult(galleriesRequest);
    await galleriesDone;

    if (galleries.length === 0) return [];

    const photosTransaction = database.transaction(PHOTOS_STORE, "readonly");
    const photosDone = transactionDone(photosTransaction);
    const photosIndex = photosTransaction.objectStore(PHOTOS_STORE).index(GALLERY_PHOTOS_INDEX);
    const counts = await Promise.all(
      galleries.map((gallery) => requestResult(photosIndex.count(IDBKeyRange.only(gallery.id)))),
    );
    await photosDone;

    return galleries
      .map((gallery, index) => ({
        ...gallery,
        photoCount: counts[index] ?? 0,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    database.close();
  }
}

export async function getLocalDeliveryGallery(
  galleryId: string,
): Promise<{ gallery: LocalDeliveryGallery; photos: LocalDeliveryPhoto[] } | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([GALLERIES_STORE, PHOTOS_STORE], "readonly");
    const done = transactionDone(transaction);
    const galleryRequest = transaction.objectStore(GALLERIES_STORE).get(galleryId) as IDBRequest<
      LocalDeliveryGallery | undefined
    >;
    const photosRequest = transaction
      .objectStore(PHOTOS_STORE)
      .index(GALLERY_PHOTOS_INDEX)
      .getAll(IDBKeyRange.only(galleryId)) as IDBRequest<LocalDeliveryPhoto[]>;
    const [gallery, photos] = await Promise.all([
      requestResult(galleryRequest),
      requestResult(photosRequest),
    ]);
    await done;

    if (!gallery) return null;
    return {
      gallery,
      photos: photos.sort((a, b) => a.sortOrder - b.sortOrder),
    };
  } finally {
    database.close();
  }
}

export async function createLocalDeliveryGallery(
  input: GalleryInput,
): Promise<LocalDeliveryGallery> {
  const gallery = createLocalDeliveryGalleryRecord(input);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(GALLERIES_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(GALLERIES_STORE).add(gallery);
    await done;
    return gallery;
  } finally {
    database.close();
  }
}

export async function updateLocalDeliveryGallery(
  galleryId: string,
  update: GalleryUpdate,
): Promise<LocalDeliveryGallery> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(GALLERIES_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(GALLERIES_STORE);
    let gallery: LocalDeliveryGallery | null = null;
    let operationError: Error | null = null;
    const request = store.get(galleryId) as IDBRequest<LocalDeliveryGallery | undefined>;
    request.onsuccess = () => {
      const current = request.result;
      if (!current) {
        operationError = new Error("That local gallery no longer exists.");
        transaction.abort();
        return;
      }

      try {
        const title = update.title === undefined ? current.title : update.title.trim();
        if (!title) throw new Error("Give this gallery a name first.");
        gallery = {
          ...current,
          title,
          message:
            update.message === undefined ? current.message : normalizedMessage(update.message),
          downloadsEnabled: update.downloadsEnabled ?? current.downloadsEnabled,
          updatedAt: new Date().toISOString(),
        };
        store.put(gallery);
      } catch (cause) {
        operationError =
          cause instanceof Error ? cause : new Error("Could not update the local gallery.");
        transaction.abort();
      }
    };

    try {
      await done;
    } catch (cause) {
      if (operationError) throw operationError;
      throw cause;
    }
    if (!gallery) throw new Error("Could not update the local gallery.");
    return gallery;
  } finally {
    database.close();
  }
}

export async function addLocalDeliveryPhotos(
  galleryId: string,
  drafts: LocalDeliveryPhotoDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;

  const database = await openDatabase();
  try {
    const transaction = database.transaction([GALLERIES_STORE, PHOTOS_STORE], "readwrite");
    const done = transactionDone(transaction);
    const galleryStore = transaction.objectStore(GALLERIES_STORE);
    const photoStore = transaction.objectStore(PHOTOS_STORE);
    let current: LocalDeliveryGallery | undefined;
    let latestPhoto: LocalDeliveryPhoto | undefined;
    let galleryReady = false;
    let orderReady = false;
    let writesQueued = false;
    let operationError: Error | null = null;

    const abort = (cause: unknown) => {
      operationError =
        cause instanceof Error ? cause : new Error("Could not save the local previews.");
      transaction.abort();
    };
    const queueWrites = () => {
      if (!galleryReady || !orderReady || writesQueued || !current) return;
      writesQueued = true;
      try {
        const now = new Date().toISOString();
        const nextSortOrder = (latestPhoto?.sortOrder ?? -1) + 1;
        drafts.forEach((draft, index) => {
          const photo: LocalDeliveryPhoto = {
            id: nextId(),
            galleryId,
            ...draft,
            sortOrder: nextSortOrder + index,
            createdAt: now,
          };
          photoStore.add(photo);
        });
        galleryStore.put({ ...current, updatedAt: now });
      } catch (cause) {
        abort(cause);
      }
    };

    const galleryRequest = galleryStore.get(galleryId) as IDBRequest<
      LocalDeliveryGallery | undefined
    >;
    galleryRequest.onsuccess = () => {
      current = galleryRequest.result;
      galleryReady = true;
      if (!current) {
        abort(new Error("That local gallery no longer exists."));
        return;
      }
      queueWrites();
    };

    const latestRequest = photoStore
      .index(GALLERY_PHOTO_ORDER_INDEX)
      .openCursor(IDBKeyRange.bound([galleryId, 0], [galleryId, Number.MAX_SAFE_INTEGER]), "prev");
    latestRequest.onsuccess = () => {
      latestPhoto = latestRequest.result?.value as LocalDeliveryPhoto | undefined;
      orderReady = true;
      queueWrites();
    };

    try {
      await done;
    } catch (cause) {
      if (operationError) throw operationError;
      throw cause;
    }
    return drafts.length;
  } finally {
    database.close();
  }
}

export async function deleteLocalDeliveryPhoto(photoId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([GALLERIES_STORE, PHOTOS_STORE], "readwrite");
    const done = transactionDone(transaction);
    const photoStore = transaction.objectStore(PHOTOS_STORE);
    const galleryStore = transaction.objectStore(GALLERIES_STORE);
    const photoRequest = photoStore.get(photoId) as IDBRequest<LocalDeliveryPhoto | undefined>;
    photoRequest.onsuccess = () => {
      const photo = photoRequest.result;
      if (!photo) return;
      photoStore.delete(photoId);

      const galleryRequest = galleryStore.get(photo.galleryId) as IDBRequest<
        LocalDeliveryGallery | undefined
      >;
      galleryRequest.onsuccess = () => {
        const gallery = galleryRequest.result;
        if (gallery) galleryStore.put({ ...gallery, updatedAt: new Date().toISOString() });
      };
    };
    await done;
  } finally {
    database.close();
  }
}

export async function deleteLocalDeliveryGallery(galleryId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([GALLERIES_STORE, PHOTOS_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(GALLERIES_STORE).delete(galleryId);

    const cursorRequest = transaction
      .objectStore(PHOTOS_STORE)
      .index(GALLERY_PHOTOS_INDEX)
      .openCursor(IDBKeyRange.only(galleryId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await done;
  } finally {
    database.close();
  }
}

export async function createLocalDeliveryPhotoDraft(file: File): Promise<LocalDeliveryPhotoDraft> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not a supported image.`);
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`Could not prepare ${file.name}.`);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const previewBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PREVIEW_QUALITY),
    );
    if (!previewBlob) throw new Error(`Could not prepare ${file.name}.`);

    return {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      lastModified: file.lastModified,
      width: bitmap.width,
      height: bitmap.height,
      previewBlob,
    };
  } finally {
    bitmap.close();
  }
}

export function buildLocalDeliveryManifest(
  gallery: LocalDeliveryGallery,
  photos: LocalDeliveryPhoto[],
  exportedAt = new Date().toISOString(),
): LocalDeliveryManifest {
  return {
    version: 1,
    kind: "lenslabs-local-gallery-draft",
    scope: "local-only",
    exportedAt,
    gallery: {
      title: gallery.title,
      message: gallery.message,
      downloadsWhenPublished: gallery.downloadsEnabled,
      createdAt: gallery.createdAt,
      updatedAt: gallery.updatedAt,
    },
    files: [...photos]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ filename, mimeType, size, lastModified, width, height, sortOrder }) => ({
        filename,
        mimeType,
        size,
        lastModified,
        width,
        height,
        sortOrder,
      })),
    note: "Planning manifest only. No files were uploaded and no gallery was published.",
  };
}
