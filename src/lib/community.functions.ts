import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CHANNELS = [
  { id: "general", label: "general", blurb: "say hi, share work" },
  { id: "pricing", label: "pricing", blurb: "rates, raises, quotes" },
  { id: "clients", label: "clients", blurb: "finding + keeping them" },
  { id: "boundaries", label: "boundaries", blurb: "late, flaky, scope creep" },
  { id: "gear", label: "gear", blurb: "bodies, glass, lights" },
  { id: "critique", label: "critique", blurb: "tear my frame apart" },
] as const;

const CHANNEL_IDS = CHANNELS.map((c) => c.id) as readonly string[];

/** The caller's own community profile (null until they join). */
export const getMyMemberProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("community_profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    return data;
  });

export const saveMemberProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      handle: string;
      display_name: string;
      bio?: string;
      city?: string;
      specialty?: string;
      website?: string;
    }) => {
      const handle = d.handle?.trim().toLowerCase().replace(/^@/, "");
      if (!handle || !/^[a-z0-9_.-]{3,24}$/.test(handle))
        throw new Error("Handle: 3–24 letters, numbers, . _ or -");
      if (!d.display_name?.trim()) throw new Error("Add a display name");
      return { ...d, handle };
    },
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("community_profiles")
      .upsert({
        id: context.userId,
        handle: data.handle,
        display_name: data.display_name.trim(),
        bio: data.bio?.trim() || null,
        city: data.city?.trim() || null,
        specialty: data.specialty?.trim() || null,
        website: data.website?.trim() || null,
        avatar_seed: data.handle,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error)
      return {
        error: error.code === "23505" ? "That handle is taken." : error.message,
      };
    return { profile: row };
  });

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("community_profiles")
      .select("id, handle, display_name, bio, city, specialty, website, avatar_seed")
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export type FeedPost = {
  id: string;
  body: string;
  channel: string;
  parent_id: string | null;
  created_at: string;
  author_id: string;
  author_handle: string;
  author_name: string;
  mine: boolean;
};

export const listFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { channel: string }) => ({
    channel: CHANNEL_IDS.includes(d.channel) ? d.channel : "general",
  }))
  .handler(async ({ data, context }): Promise<FeedPost[]> => {
    const { data: posts } = await context.supabase
      .from("community_posts")
      .select("id, body, channel, parent_id, created_at, author_id")
      .eq("channel", data.channel)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!posts?.length) return [];

    const ids = [...new Set(posts.map((p) => p.author_id))];
    const { data: authors } = await context.supabase
      .from("community_profiles")
      .select("id, handle, display_name")
      .in("id", ids);
    const byId = new Map((authors ?? []).map((a) => [a.id, a]));

    return posts.map((p) => ({
      ...p,
      author_handle: byId.get(p.author_id)?.handle ?? "member",
      author_name: byId.get(p.author_id)?.display_name ?? "Member",
      mine: p.author_id === context.userId,
    }));
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { channel: string; body: string; parent_id?: string | null }) => {
    const body = d.body?.trim();
    if (!body) throw new Error("Write something first");
    if (body.length > 4000) throw new Error("That's too long for the feed");
    return {
      body,
      channel: CHANNEL_IDS.includes(d.channel) ? d.channel : "general",
      parent_id: d.parent_id ?? null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("community_profiles")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me) return { error: "Create your member profile first." };

    const { error } = await context.supabase.from("community_posts").insert({
      author_id: context.userId,
      channel: data.channel,
      parent_id: data.parent_id,
      body: data.body,
    });
    return error ? { error: error.message } : { ok: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("community_posts")
      .delete()
      .eq("id", data.id)
      .eq("author_id", context.userId);
    return error ? { error: error.message } : { ok: true };
  });
