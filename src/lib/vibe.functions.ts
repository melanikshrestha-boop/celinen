import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VibeMessage = { role: "assistant" | "user"; content: string };

const SYSTEM = `You are the LensLabs shoot concierge. You talk to a photography CLIENT before their shoot is confirmed.
Your job: understand the vibe they want in plain language, because most clients cannot describe "cinematic",
"editorial" or "moody" even though they have seen it.

Rules:
- Ask ONE short question at a time. Never a wall of text. Max 2 sentences plus (optionally) 3 short example options.
- Translate vague words into concrete photographic choices: light (hard/soft, golden hour, flash), colour (warm, muted, filmic),
  framing (tight portrait, wide environmental), wardrobe, location, and how the final images get used.
- Also gather the boring-but-critical logistics ONCE: how many final images they expect, deadline, and who else is on set.
- Be warm, short, never salesy, never pushy. If they say they are done, stop asking and summarise.
- After roughly 6 exchanges, or whenever they ask, give a short "Here's the brief" summary in 4 bullet points.
Never promise pricing, dates, or deliverables on the photographer's behalf.`;

async function askAI(messages: VibeMessage[]) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return { error: "The assistant is not configured yet." };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [{ role: "system", content: SYSTEM }, ...messages],
      max_tokens: 400,
    }),
  });

  if (res.status === 429) return { error: "Too many messages right now — try again in a moment." };
  if (res.status === 402) return { error: "The studio's AI credits are used up." };
  if (!res.ok) return { error: "The assistant could not answer just now." };

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = json.choices?.[0]?.message?.content?.trim();
  if (!reply) return { error: "The assistant returned an empty answer." };
  return { reply };
}

const OPENER =
  "Hey — before your shoot gets locked in, can I ask a few quick things about the look you're after? First one: when you picture these photos, are they bright and airy, warm and golden, or dark and moody?";

/** Fetch (or lazily create) the caller's own vibe session. Consent starts off. */
export const getVibeSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("vibe_sessions")
      .select("*")
      .eq("owner_auth_id", userId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;

    const { data: booking } = await supabase
      .from("booking_requests")
      .select("id, client_id, user_id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await supabase
      .from("vibe_sessions")
      .insert({
        owner_auth_id: userId,
        booking_id: booking?.id ?? null,
        client_id: booking?.client_id ?? null,
        user_id: booking?.user_id ?? null,
        consent: false,
        messages: [],
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

/** Opt in or out. Opting out clears everything already said. */
export const setVibeConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; consent: boolean }) => d)
  .handler(async ({ data, context }) => {
    const patch = data.consent
      ? {
          consent: true,
          consent_at: new Date().toISOString(),
          messages: [{ role: "assistant", content: OPENER }],
          updated_at: new Date().toISOString(),
        }
      : {
          consent: false,
          consent_at: null,
          messages: [],
          summary: null,
          vibe_tags: [],
          updated_at: new Date().toISOString(),
        };

    const { data: row, error } = await context.supabase
      .from("vibe_sessions")
      .update(patch)
      .eq("id", data.id)
      .eq("owner_auth_id", context.userId)
      .select("*")
      .single();
    return error ? { error: error.message } : { session: row };
  });

/** One turn of the conversation. Refuses without consent. */
export const sendVibeMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; text: string }) => {
    if (!d.text?.trim()) throw new Error("Say something first");
    if (d.text.length > 2000) throw new Error("That message is a bit long");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: session } = await supabase
      .from("vibe_sessions")
      .select("*")
      .eq("id", data.id)
      .eq("owner_auth_id", userId)
      .maybeSingle();
    if (!session) return { error: "Session not found" };
    if (!session.consent) return { error: "Turn the assistant on first." };

    const history = (session.messages as VibeMessage[] | null) ?? [];
    const withUser: VibeMessage[] = [
      ...history,
      { role: "user" as const, content: data.text.trim() },
    ].slice(-24);

    const out = await askAI(withUser);
    if ("error" in out) {
      await supabase
        .from("vibe_sessions")
        .update({ messages: withUser, updated_at: new Date().toISOString() })
        .eq("id", session.id);
      return { messages: withUser, error: out.error };
    }

    const next: VibeMessage[] = [...withUser, { role: "assistant", content: out.reply }];
    const { error } = await supabase
      .from("vibe_sessions")
      .update({ messages: next, updated_at: new Date().toISOString() })
      .eq("id", session.id);
    if (error) return { error: error.message };
    return { messages: next };
  });

/** Wrap the conversation into a brief the photographer can read. */
export const finishVibeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: session } = await supabase
      .from("vibe_sessions")
      .select("*")
      .eq("id", data.id)
      .eq("owner_auth_id", userId)
      .maybeSingle();
    if (!session) return { error: "Session not found" };

    const history = (session.messages as VibeMessage[] | null) ?? [];
    if (history.length < 2) return { error: "Chat a little first." };

    const out = await askAI([
      ...history,
      {
        role: "user",
        content:
          "Write the final brief for my photographer. Line 1: 'BRIEF'. Then 4 short bullets (look, light/colour, must-have shots, logistics). Then a final line 'TAGS: a, b, c' with 3 lowercase style tags.",
      },
    ]);
    if ("error" in out) return { error: out.error };

    const tagLine = /TAGS:\s*(.+)$/im.exec(out.reply)?.[1] ?? "";
    const tags = tagLine
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    const summary = out.reply.replace(/TAGS:.*$/im, "").trim();

    const { data: row, error } = await supabase
      .from("vibe_sessions")
      .update({
        summary,
        vibe_tags: tags,
        status: "complete",
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .select("*")
      .single();
    return error ? { error: error.message } : { session: row };
  });
