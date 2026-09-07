import { describe, expect, test } from "bun:test";
import {
  buildLocalDeliveryManifest,
  createLocalDeliveryGalleryRecord,
  type LocalDeliveryPhoto,
} from "../src/lib/delivery/local";

describe("local delivery drafts", () => {
  test("normalizes gallery text without adding cloud delivery state", () => {
    const gallery = createLocalDeliveryGalleryRecord(
      { title: "  Spring lookbook  ", message: "   " },
      { id: "gallery-1", now: "2026-09-04T12:00:00.000Z" },
    );

    expect(gallery).toEqual({
      id: "gallery-1",
      title: "Spring lookbook",
      message: null,
      downloadsEnabled: false,
      createdAt: "2026-09-04T12:00:00.000Z",
      updatedAt: "2026-09-04T12:00:00.000Z",
    });
    expect(Object.hasOwn(gallery, "slug")).toBe(false);
    expect(Object.hasOwn(gallery, "passcode")).toBe(false);
    expect(Object.hasOwn(gallery, "status")).toBe(false);
  });

  test("rejects a gallery without a name", () => {
    expect(() =>
      createLocalDeliveryGalleryRecord(
        { title: "   " },
        { id: "gallery-1", now: "2026-09-04T12:00:00.000Z" },
      ),
    ).toThrow("Give this gallery a name first.");
  });

  test("exports metadata only and explicitly marks the manifest local", () => {
    const gallery = {
      ...createLocalDeliveryGalleryRecord(
        { title: "Spring lookbook", message: "Review draft" },
        { id: "gallery-1", now: "2026-09-04T12:00:00.000Z" },
      ),
      downloadsEnabled: true,
    };
    const photos: LocalDeliveryPhoto[] = [
      {
        id: "photo-2",
        galleryId: gallery.id,
        filename: "frame-002.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        lastModified: 2,
        width: 6000,
        height: 4000,
        sortOrder: 1,
        previewBlob: new Blob(["preview"]),
        createdAt: "2026-09-04T12:02:00.000Z",
      },
      {
        id: "photo-1",
        galleryId: gallery.id,
        filename: "frame-001.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        lastModified: 1,
        width: 4000,
        height: 6000,
        sortOrder: 0,
        previewBlob: new Blob(["preview"]),
        createdAt: "2026-09-04T12:01:00.000Z",
      },
    ];

    const manifest = buildLocalDeliveryManifest(gallery, photos, "2026-09-04T12:10:00.000Z");
    const serialized = JSON.stringify(manifest);

    expect(manifest.scope).toBe("local-only");
    expect(manifest.files.map((file) => file.filename)).toEqual(["frame-001.jpg", "frame-002.jpg"]);
    expect(manifest.gallery.downloadsWhenPublished).toBe(true);
    expect(manifest.note).toContain("No files were uploaded");
    expect(serialized).not.toContain("previewBlob");
    expect(serialized).not.toContain("gallery-1");
    expect(serialized).not.toContain("photo-1");
    expect(serialized).not.toContain("passcode");
  });
});
