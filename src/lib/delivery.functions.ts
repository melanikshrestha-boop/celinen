import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const SIGNED_TTL = 60 * 60 * 6; // 6 hours
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERATED_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]+$/;
type GalleryScope = { id: string; user_id: string };
type GalleryPhotoSource = { storage_path: string; user_id: string; gallery_id: string };

/** Match the existing direct uploader exactly; never normalize an untrusted storage path. */
function isGalleryPath(path: unknown, gallery: GalleryScope): path is string {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    UUID.exec(gallery.user_id)?.[0] === gallery.user_id &&
    UUID.exec(gallery.id)?.[0] === gallery.id &&
    parts[0] === gallery.user_id &&
    parts[1] === gallery.id &&
    typeof parts[2] === "string" &&
    // Full-match equality also rejects the final newline accepted by JavaScript's `$` anchor.
    GENERATED_FILE.exec(parts[2])?.[0] === parts[2]
  );
}

function isGalleryPhoto(photo: GalleryPhotoSource, gallery: GalleryScope) {
  return (
    photo.user_id === gallery.user_id &&
    photo.gallery_id === gallery.id &&
    isGalleryPath(photo.storage_path, gallery)
  );
}

/** Stored legacy rows are not capabilities. Filter before invoking even a service-role signer. */
async function signGalleryPhotos(
  supabase: SupabaseClient<Database>,
  gallery: GalleryScope,
  photos: GalleryPhotoSource[],
) {
  const paths = [
    ...new Set(
      photos.filter((photo) => isGalleryPhoto(photo, gallery)).map((photo) => photo.storage_path),
    ),
  ];
  const urls = new Map<string, string>();
  if (!paths.length) return urls;
  try {
    const { data: signed, error } = await supabase.storage
      .from("deliveries")
      .createSignedUrls(paths, SIGNED_TTL);
    if (error) return urls;
    const allowed = new Set(paths);
    for (const item of signed ?? []) {
      if (item.path && allowed.has(item.path) && !item.error && item.signedUrl) {
        urls.set(item.path, item.signedUrl);
      }
    }
  } catch {
    // Keep all rows visible with unavailable sources when Storage is unavailable.
  }
  return urls;
}

async function verifyGalleryObjects(supabase: SupabaseClient<Database>, paths: string[]) {
  const bucket = supabase.storage.from("deliveries");
  // Bound metadata requests independently of batch size; do not upload or decode again.
  for (let offset = 0; offset < paths.length; offset += 4) {
    const verified = await Promise.all(
      paths.slice(offset, offset + 4).map(async (path) => {
        try {
          const { data: object, error } = await bucket.info(path);
          return (
            !error &&
            object?.name === path &&
            object.bucketId === "deliveries" &&
            Number.isSafeInteger(object.size) &&
            Number(object.size) > 0
          );
        } catch {
          return false;
        }
      }),
    );
    if (verified.some((present) => !present)) return false;
  }
  return true;
}

function makeSlug(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  const tail = Math.random().toString(36).slice(2, 7);
  return `${base || "gallery"}-${tail}`;
}

/* ---------------- photographer side ---------------- */

export const listGalleries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: galleries } = await context.supabase
      .from("galleries")
      .select("*")
      .order("created_at", { ascending: false });
    if (!galleries?.length) return [];

    const ids = galleries.map((g) => g.id);
    const [{ data: photos }, { data: favorites }] = await Promise.all([
      context.supabase.from("gallery_photos").select("id, gallery_id").in("gallery_id", ids),
      context.supabase.from("gallery_favorites").select("id, gallery_id").in("gallery_id", ids),
    ]);

    return galleries.map((g) => ({
      ...g,
      photo_count: (photos ?? []).filter((p) => p.gallery_id === g.id).length,
      favorite_count: (favorites ?? []).filter((f) => f.gallery_id === g.id).length,
    }));
  });

export const createGallery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      title: string;
      client_id?: string | null;
      shoot_id?: string | null;
      message?: string | null;
      passcode?: string | null;
      downloads_enabled?: boolean;
      expires_at?: string | null;
    }) => {
      if (!d.title?.trim()) throw new Error("Gallery needs a title");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: gallery, error } = await context.supabase
      .from("galleries")
      .insert({
        user_id: context.userId,
        title: data.title.trim(),
        slug: makeSlug(data.title),
        client_id: data.client_id ?? null,
        shoot_id: data.shoot_id ?? null,
        message: data.message ?? null,
        passcode: data.passcode?.trim() || null,
        downloads_enabled: data.downloads_enabled ?? true,
        expires_at: data.expires_at ?? null,
        status: "live",
      })
      .select("*")
      .single();
    if (error) return { error: error.message };
    return { gallery };
  });

export const updateGallery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      title?: string;
      message?: string | null;
      status?: "draft" | "live" | "archived";
      downloads_enabled?: boolean;
      passcode?: string | null;
      expires_at?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("galleries").update(patch).eq("id", id);
    return error ? { error: error.message } : { ok: true };
  });

export const deleteGallery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: gallery, error: galleryError } = await context.supabase
      .from("galleries")
      .select("id, user_id")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (galleryError || !gallery || gallery.id !== data.id || gallery.user_id !== context.userId)
      return { error: "Gallery not found" };

    const { data: photos, error: photosError } = await context.supabase
      .from("gallery_photos")
      .select("storage_path, user_id, gallery_id")
      .eq("gallery_id", gallery.id);
    if (photosError) return { error: "Could not verify gallery photos. Please try again." };

    const paths = [
      ...new Set(
        (photos ?? [])
          .filter((photo) => isGalleryPhoto(photo, gallery))
          .map((photo) => photo.storage_path),
      ),
    ];
    if (paths.length) {
      try {
        const { error } = await context.supabase.storage.from("deliveries").remove(paths);
        if (error) return { error: "Could not remove gallery files. Please try again." };
      } catch {
        return { error: "Could not remove gallery files. Please try again." };
      }
    }
    const { error } = await context.supabase
      .from("galleries")
      .delete()
      .eq("id", gallery.id)
      .eq("user_id", context.userId);
    return error ? { error: error.message } : { ok: true };
  });

/** Register files already uploaded to the `deliveries` bucket. */
export const addGalleryPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      gallery_id: string;
      files: {
        storage_path: string;
        filename: string;
        width?: number;
        height?: number;
        folder?: "proofs" | "edited";
      }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    // RLS-scoped read: only returns the gallery when the caller owns it.
    const { data: gallery, error: galleryError } = await context.supabase
      .from("galleries")
      .select("id, user_id")
      .eq("id", data.gallery_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (
      galleryError ||
      !gallery ||
      gallery.user_id !== context.userId ||
      gallery.id !== data.gallery_id
    )
      return { error: "Gallery not found" };

    if (
      !Array.isArray(data.files) ||
      data.files.some(
        (file) =>
          !file ||
          !isGalleryPath(file.storage_path, gallery) ||
          typeof file.filename !== "string" ||
          !file.filename.length,
      )
    )
      return { error: "Photo upload does not belong to this gallery" };
    if (!data.files.length) return { added: 0 };
    if (
      !(await verifyGalleryObjects(
        context.supabase,
        data.files.map((file) => file.storage_path),
      ))
    ) {
      return { error: "Photo upload is missing or incomplete. Finish uploading and try again." };
    }

    const { count, error: countError } = await context.supabase
      .from("gallery_photos")
      .select("id", { count: "exact", head: true })
      .eq("gallery_id", data.gallery_id);
    if (countError || count === null) return { error: "Could not verify the gallery photo order" };
    const rows = data.files.map((f, i) => ({
      gallery_id: data.gallery_id,
      user_id: context.userId,
      storage_path: f.storage_path,
      filename: f.filename,
      width: f.width ?? null,
      height: f.height ?? null,
      sort_order: (count ?? 0) + i,
      folder: f.folder === "edited" ? "edited" : "proofs",
    }));
    const { error } = await context.supabase.from("gallery_photos").insert(rows);
    if (error) return { error: error.message };

    if (!count) {
      await context.supabase
        .from("galleries")
        .update({ cover_path: rows[0]?.storage_path ?? null })
        .eq("id", data.gallery_id);
    }
    return { added: rows.length };
  });

/** Photographer view of one gallery: photos with signed URLs + client picks. */
export const getGallery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: gallery, error: galleryError } = await context.supabase
      .from("galleries")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (galleryError || !gallery || gallery.id !== data.id || gallery.user_id !== context.userId)
      return { error: "Gallery not found" };

    const [{ data: photos }, { data: favorites }] = await Promise.all([
      context.supabase
        .from("gallery_photos")
        .select("*")
        .eq("gallery_id", data.id)
        .order("sort_order"),
      context.supabase.from("gallery_favorites").select("*").eq("gallery_id", data.id),
    ]);

    const urls = await signGalleryPhotos(context.supabase, gallery, photos ?? []);

    return {
      gallery,
      photos: (photos ?? []).map((p) => ({
        ...p,
        url: isGalleryPhoto(p, gallery) ? (urls.get(p.storage_path) ?? null) : null,
      })),
      favorites: favorites ?? [],
    };
  });

/* ---------------- client (public) side ---------------- */

export const openGallery = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; passcode?: string; visitor?: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mintVisitorToken, verifyVisitorToken } = await import("@/lib/gallery-visitor.server");

    const { data: gallery, error: galleryError } = await supabaseAdmin
      .from("galleries")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (galleryError || !gallery || gallery.status !== "live")
      return { error: "not_found" as const };
    if (gallery.expires_at && new Date(gallery.expires_at).getTime() < Date.now())
      return { error: "expired" as const };
    if (gallery.passcode && gallery.passcode !== (data.passcode ?? ""))
      return { error: "passcode" as const, title: gallery.title };

    // Reuse the caller's token when it is genuinely ours for this gallery, else mint a fresh one.
    const existingVisitor = verifyVisitorToken(gallery.id, data.visitor);
    const visitorToken = existingVisitor ? data.visitor! : mintVisitorToken(gallery.id);
    const visitorId = existingVisitor ?? verifyVisitorToken(gallery.id, visitorToken)!;

    const [{ data: photos }, { data: favorites }] = await Promise.all([
      supabaseAdmin
        .from("gallery_photos")
        .select("id, user_id, gallery_id, filename, storage_path, width, height, sort_order")
        .eq("gallery_id", gallery.id)
        .order("sort_order"),
      supabaseAdmin
        .from("gallery_favorites")
        .select("photo_id")
        .eq("gallery_id", gallery.id)
        .eq("viewer", visitorId),
    ]);

    const urls = await signGalleryPhotos(supabaseAdmin, gallery, photos ?? []);

    await supabaseAdmin
      .from("galleries")
      .update({ view_count: (gallery.view_count ?? 0) + 1 })
      .eq("id", gallery.id);

    return {
      gallery: {
        id: gallery.id,
        title: gallery.title,
        message: gallery.message,
        downloads_enabled: gallery.downloads_enabled,
      },
      visitor_token: visitorToken,
      photos: (photos ?? []).map((p) => ({
        id: p.id,
        filename: p.filename,
        url: isGalleryPhoto(p, gallery) ? (urls.get(p.storage_path) ?? null) : null,
        width: p.width,
        height: p.height,
      })),
      favorites: (favorites ?? []).map((f) => f.photo_id as string),
    };
  });

export const toggleGalleryFavorite = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; photo_id: string; on: boolean; visitor: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyVisitorToken } = await import("@/lib/gallery-visitor.server");

    const { data: gallery } = await supabaseAdmin
      .from("galleries")
      .select("id, status, expires_at")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!gallery || gallery.status !== "live") return { error: "Gallery is not open" };
    if (gallery.expires_at && new Date(gallery.expires_at).getTime() < Date.now())
      return { error: "Gallery link expired" };

    // A gallery link on its own cannot write: the visitor token is the credential.
    const viewer = verifyVisitorToken(gallery.id, data.visitor);
    if (!viewer) return { error: "Open the gallery again to pick favourites" };

    // The photo must belong to this gallery.
    const { data: photo } = await supabaseAdmin
      .from("gallery_photos")
      .select("id")
      .eq("id", data.photo_id)
      .eq("gallery_id", gallery.id)
      .maybeSingle();
    if (!photo) return { error: "Photo is not in this gallery" };

    if (data.on) {
      await supabaseAdmin
        .from("gallery_favorites")
        .upsert(
          { gallery_id: gallery.id, photo_id: data.photo_id, viewer },
          { onConflict: "photo_id,viewer", ignoreDuplicates: true },
        );
    } else {
      await supabaseAdmin
        .from("gallery_favorites")
        .delete()
        .eq("gallery_id", gallery.id)
        .eq("photo_id", data.photo_id)
        .eq("viewer", viewer);
    }
    return { ok: true };
  });
