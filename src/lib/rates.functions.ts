import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PackageInput = {
  id?: string;
  title: string;
  blurb?: string | null;
  price: number;
  unit?: string;
  duration?: string | null;
  deliverables?: string | null;
  turnaround?: string | null;
  sort_order?: number;
  published?: boolean;
};

/* ---------------- photographer side ---------------- */

export const listMyPackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("shoot_packages")
      .select("*")
      .eq("user_id", context.userId)
      .order("sort_order", { ascending: true })
      .order("price", { ascending: true });
    return data ?? [];
  });

export const savePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PackageInput) => {
    if (!d.title?.trim()) throw new Error("Give the package a name");
    if (!Number.isFinite(d.price) || d.price < 0) throw new Error("Price must be a number");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: saved, error } = await context.supabase
      .from("shoot_packages")
      .upsert({
        ...data,
        user_id: context.userId,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    return error ? { error: error.message } : { pkg: saved };
  });

export const deletePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shoot_packages")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return error ? { error: error.message } : { ok: true };
  });

export const saveStudioProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      studio_name?: string | null;
      bio?: string | null;
      city?: string | null;
      specialty?: string | null;
      travel_note?: string | null;
      booking_note?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, ...data, updated_at: new Date().toISOString() });
    return error ? { error: error.message } : { ok: true };
  });

/* ---------------- client side ---------------- */

/**
 * Rate card a signed-in client can see: the published packages of every
 * photographer whose client record is linked to this account.
 */
export const getStudioRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: clients } = await context.supabase
      .from("clients")
      .select("user_id")
      .eq("auth_user_id", context.userId);
    const owners = [...new Set((clients ?? []).map((c) => c.user_id))];
    if (owners.length === 0) return { studios: [] as StudioRates[] };

    const { data: packages } = await context.supabase
      .from("shoot_packages")
      .select("*")
      .in("user_id", owners)
      .eq("published", true)
      .order("price", { ascending: true });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, studio_name, full_name, bio, city, specialty, travel_note, booking_note")
      .in("id", owners);

    const studios: StudioRates[] = owners.map((id) => {
      const p = (profiles ?? []).find((x) => x.id === id) ?? null;
      return {
        userId: id,
        name: p?.studio_name || p?.full_name || "Your photographer",
        bio: p?.bio ?? null,
        city: p?.city ?? null,
        specialty: p?.specialty ?? null,
        travelNote: p?.travel_note ?? null,
        bookingNote: p?.booking_note ?? null,
        packages: (packages ?? []).filter((pk) => pk.user_id === id),
      };
    });

    return { studios };
  });

export type StudioRates = {
  userId: string;
  name: string;
  bio: string | null;
  city: string | null;
  specialty: string | null;
  travelNote: string | null;
  bookingNote: string | null;
  packages: {
    id: string;
    title: string;
    blurb: string | null;
    price: number;
    currency: string;
    unit: string;
    duration: string | null;
    deliverables: string | null;
    turnaround: string | null;
  }[];
};
