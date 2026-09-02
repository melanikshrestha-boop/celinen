import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { supabase } from "@/integrations/supabase/client";
import {
  CHANNELS,
  createPost,
  deletePost,
  getMyMemberProfile,
  listFeed,
  listMembers,
  saveMemberProfile,
  type FeedPost,
} from "@/lib/community.functions";

export const Route = createFileRoute("/community")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Photographers' room — LensLabs" },
      {
        name: "description",
        content:
          "A private room for working photographers: pricing, clients, boundaries and critique. No clients, no lurkers.",
      },
      { property: "og:title", content: "Photographers' room — LensLabs" },
      {
        property: "og:description",
        content: "Talk rates, clients and boundaries with photographers who actually shoot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Community,
});

type Member = Awaited<ReturnType<typeof listMembers>>[number];
type Profile = Awaited<ReturnType<typeof getMyMemberProfile>>;

function Avatar({ seed, size = 34 }: { seed: string; size?: number }) {
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-mono text-[11px] uppercase text-paper2"
      style={{ width: size, height: size, background: `oklch(0.55 0.08 ${hue})` }}
    >
      {seed.slice(0, 2)}
    </span>
  );
}

function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function Community() {
  const [auth, setAuth] = useState<"loading" | "anon" | "in">("loading");
  const [me, setMe] = useState<Profile>(null);
  const [channel, setChannel] = useState<string>("general");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  /* join form */
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      if (!data.user) return setAuth("anon");
      setAuth("in");
      const [p, m] = await Promise.all([getMyMemberProfile(), listMembers()]);
      if (!alive) return;
      setMe(p);
      setMembers(m);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async (ch: string) => {
    setPosts(await listFeed({ data: { channel: ch } }));
  }, []);

  useEffect(() => {
    if (auth !== "in" || !me) return;
    void refresh(channel);
    const t = setInterval(() => void refresh(channel), 8000);
    return () => clearInterval(t);
  }, [auth, me, channel, refresh]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [posts]);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await saveMemberProfile({
        data: { handle, display_name: name, city, specialty, bio },
      });
      if ("error" in res && res.error) setErr(res.error);
      else if (res.profile) {
        setMe(res.profile);
        setMembers(await listMembers());
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not join");
    }
    setBusy(false);
  };

  const post = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const res = await createPost({ data: { channel, body } });
    if ("error" in res && res.error) setErr(res.error);
    else setBody("");
    await refresh(channel);
    setBusy(false);
  };

  if (auth === "loading") {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <LogoMark size={40} className="iris-spin text-moss" />
      </div>
    );
  }

  if (auth === "anon") {
    return (
      <div className="grid min-h-[70vh] place-items-center px-6 text-center">
        <div className="max-w-[420px]">
          <LogoMark size={56} className="iris-breathe mx-auto text-ink" />
          <h1 className="mt-6 font-display text-[28px] font-semibold tracking-tight">
            The photographers&apos; room
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-moss">
            Rates, clients, boundaries, critique. Photographers only — no clients in here.
          </p>
          <Link
            to="/auth"
            search={{ next: "/community", mode: "signin" }}
            className="mt-6 inline-block rounded-xl bg-rust px-5 py-2.5 text-[14px] font-semibold text-paper2 hover:opacity-90"
          >
            Sign in to join
          </Link>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto w-full max-w-[520px] px-5 py-14">
        <LogoMark size={44} className="iris-breathe text-ink" />
        <h1 className="mt-5 font-display text-[26px] font-semibold tracking-tight">
          Claim your handle
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-moss">
          This is how other photographers see you. Nothing from your studio is shared.
        </p>
        <div className="mt-6 grid gap-3">
          {[
            { v: handle, s: setHandle, p: "handle (e.g. mel.shoots)" },
            { v: name, s: setName, p: "display name" },
            { v: city, s: setCity, p: "city" },
            { v: specialty, s: setSpecialty, p: "weddings / editorial / brand" },
          ].map((f) => (
            <input
              key={f.p}
              value={f.v}
              onChange={(e) => f.s(e.target.value)}
              placeholder={f.p}
              className="w-full rounded-xl border border-input bg-background px-3.5 py-3 text-[16px] text-ink sm:text-[14px]"
            />
          ))}
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="one line about what you shoot"
            className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-[16px] text-ink sm:text-[14px]"
          />
          {err && <p className="text-[13px] text-destructive">{err}</p>}
          <button
            onClick={() => void join()}
            disabled={busy}
            className="rounded-xl bg-rust px-5 py-3 text-[14px] font-semibold text-paper2 hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Joining…" : "Join the room"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col px-3 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center gap-3">
        <LogoMark size={30} className="iris-breathe text-ink" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-[20px] font-semibold tracking-tight sm:text-[24px]">
            Photographers&apos; room
          </h1>
          <p className="truncate text-[12px] text-moss">
            @{me.handle} · {members.length} member{members.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => setShowMembers((v) => !v)}
          className="ml-auto shrink-0 rounded-lg border border-input px-3 py-1.5 text-[13px] hover:bg-muted lg:hidden"
        >
          {showMembers ? "Feed" : "Members"}
        </button>
      </header>

      {/* channels */}
      <div className="mt-5 -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChannel(c.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-[12px] transition-all hover:-translate-y-0.5 ${
              c.id === channel
                ? "border-ink bg-ink text-paper2"
                : "border-border bg-card text-moss hover:text-ink"
            }`}
          >
            #{c.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* feed */}
        <div className={`${showMembers ? "hidden" : "block"} lg:block`}>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div ref={feedRef} className="max-h-[58vh] overflow-y-auto px-3 py-4 sm:px-5">
              {posts.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-moss">
                  Nothing in #{channel} yet. Start it.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {posts.map((p, i) => (
                    <div
                      key={p.id}
                      className="rise-in flex gap-3"
                      style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                    >
                      <Avatar seed={p.author_handle} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-2">
                          <span className="text-[14px] font-semibold">{p.author_name}</span>
                          <span className="font-mono text-[11px] text-moss">
                            @{p.author_handle} · {timeAgo(p.created_at)}
                          </span>
                          {p.mine && (
                            <button
                              onClick={async () => {
                                await deletePost({ data: { id: p.id } });
                                await refresh(channel);
                              }}
                              className="font-mono text-[11px] text-moss underline hover:text-ink"
                            >
                              delete
                            </button>
                          )}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed">
                          {p.body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-end gap-2 border-t border-border px-3 py-3 sm:px-5">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void post();
                  }
                }}
                rows={1}
                placeholder={`message #${channel}`}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-[16px] text-ink sm:text-[14px]"
              />
              <button
                onClick={() => void post()}
                disabled={busy || !body.trim()}
                className="shrink-0 rounded-xl bg-rust px-4 py-3 text-[14px] font-semibold text-paper2 hover:opacity-90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
          {err && <p className="mt-2 text-[13px] text-destructive">{err}</p>}
        </div>

        {/* members */}
        <aside className={`${showMembers ? "block" : "hidden"} lg:block`}>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">Members</p>
            <div className="mt-3 flex flex-col gap-3">
              {members.map((m) => (
                <div key={m.id} className="flex items-start gap-2.5">
                  <Avatar seed={m.handle} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{m.display_name}</p>
                    <p className="truncate text-[11px] text-moss">
                      @{m.handle}
                      {m.city ? ` · ${m.city}` : ""}
                    </p>
                    {m.specialty && (
                      <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-moss">
                        {m.specialty}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
