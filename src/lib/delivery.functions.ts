import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SIGNED_TTL = 60 * 60 * 6; // 6 hours

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
    const { data: photos } = await context.supabase
      .from("gallery_photos")
      .select("storage_path")
      .eq("gallery_id", data.id);
    if (photos?.length) {
      await context.supabase.storage.from("deliveries").remove(photos.map((p) => p.storage_path));
    }
    const { error } = await context.supabase.from("galleries").delete().eq("id", data.id);
    return error ? { error: error.message } : { ok: true };
  });

/** Register files already uploaded to the `deliveries` bucket. */
export const addGalleryPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      gallery_id: string;
      files: { storage_path: string; filename: string; width?: number; height?: number }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    // RLS-scoped read: only returns the gallery when the caller owns it.
    const { data: gallery } = await context.supabase
      .from("galleries")
      .select("id")
      .eq("id", data.gallery_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!gallery) return { error: "Gallery not found" };

    const { count } = await context.supabase
      .from("gallery_photos")
      .select("id", { count: "exact", head: true })
      .eq("gallery_id", data.gallery_id);


    const rows = data.files.map((f, i) => ({
      gallery_id: data.gallery_id,
      user_id: context.userId,
      storage_path: f.storage_path,
      filename: f.filename,
      width: f.width ?? null,
      height: f.height ?? null,
      sort_order: (count ?? 0) + i,
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
    const { data: gallery } = await context.supabase
      .from("galleries")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!gallery) return { error: "Gallery not found" };

    const [{ data: photos }, { data: favorites }] = await Promise.all([
      context.supabase
        .from("gallery_photos")
        .select("*")
        .eq("gallery_id", data.id)
        .order("sort_order"),
      context.supabase.from("gallery_favorites").select("*").eq("gallery_id", data.id),
    ]);

    const paths = (photos ?? []).map((p) => p.storage_path);
    const { data: signed } = paths.length
      ? await context.supabase.storage.from("deliveries").createSignedUrls(paths, SIGNED_TTL)
      : { data: [] };

    return {
      gallery,
      photos: (photos ?? []).map((p, i) => ({ ...p, url: signed?.[i]?.signedUrl ?? null })),
      favorites: favorites ?? [],
    };
  });

/* ---------------- client (public) side ---------------- */

export const openGallery = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; passcode?: string; visitor?: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mintVisitorToken, verifyVisitorToken } = await import("@/lib/gallery-visitor.server");

    const { data: gallery } = await supabaseAdmin
      .from("galleries")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (!gallery || gallery.status !== "live") return { error: "not_found" as const };
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
        .select("id, filename, storage_path, width, height, sort_order")
        .eq("gallery_id", gallery.id)
        .order("sort_order"),
      supabaseAdmin
        .from("gallery_favorites")
        .select("photo_id")
        .eq("gallery_id", gallery.id)
        .eq("viewer", visitorId),
    ]);

    const paths = (photos ?? []).map((p) => p.storage_path);
    const { data: signed } = paths.length
      ? await supabaseAdmin.storage.from("deliveries").createSignedUrls(paths, SIGNED_TTL)
      : { data: [] };

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
      photos: (photos ?? []).map((p, i) => ({
        id: p.id,
        filename: p.filename,
        url: signed?.[i]?.signedUrl ?? null,
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
