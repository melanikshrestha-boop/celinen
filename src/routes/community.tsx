import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
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
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";
import "@/components/community/community-room.css";

export const Route = createFileRoute("/community")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Photographers' room — FOTO" },
      {
        name: "description",
        content:
          "A private room for working photographers: pricing, clients, boundaries and critique. No clients, no lurkers.",
      },
      { property: "og:title", content: "Photographers' room — FOTO" },
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

function CommunityShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page community-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main
        id="main-content"
        tabIndex={-1}
        className={`marketing-public-page ${wide ? "community-page__main--wide" : "community-page__main"}`}
      >
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}

function Avatar({ seed, size = 34 }: { seed: string; size?: number }) {
  const tone = 32 + ([...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 36);
  return (
    <span
      className="community-avatar"
      style={{ width: size, height: size, background: `rgb(${tone} ${tone} ${tone})` }}
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
      <CommunityShell>
        <LogoMark size={40} className="community-mark" />
      </CommunityShell>
    );
  }

  if (auth === "anon") {
    return (
      <CommunityShell>
        <div className="community-gate">
          <LogoMark size={44} className="community-mark" />
          <h1>The photographers&apos; room</h1>
          <p className="community-copy">
            Rates, clients, boundaries, critique. Photographers only — no clients in here.
          </p>
          <Link
            to="/auth"
            search={{ next: "/community", mode: "signin", google: true }}
            className="community-cta"
          >
            Sign in to join
          </Link>
        </div>
      </CommunityShell>
    );
  }

  if (!me) {
    return (
      <CommunityShell>
        <LogoMark size={44} className="community-mark" />
        <h1>Claim your handle</h1>
        <p className="community-copy">
          This is how other photographers see you. Nothing from your studio is shared.
        </p>
        <div className="community-form">
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
              className="community-field"
            />
          ))}
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="one line about what you shoot"
            className="community-field"
          />
          {err && <p className="community-error">{err}</p>}
          <button type="button" onClick={() => void join()} disabled={busy} className="community-cta">
            {busy ? "Joining…" : "Join the room"}
          </button>
        </div>
      </CommunityShell>
    );
  }

  return (
    <CommunityShell wide>
      <header className="community-head">
        <LogoMark size={30} className="community-mark" />
        <div>
          <h1>Photographers&apos; room</h1>
          <p>
            @{me.handle} · {members.length} member{members.length === 1 ? "" : "s"}
          </p>
        </div>
        <button type="button" className="community-members-toggle" onClick={() => setShowMembers((v) => !v)}>
          {showMembers ? "Feed" : "Members"}
        </button>
      </header>

      <div className="community-channels" role="tablist" aria-label="Channels">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === channel}
            onClick={() => setChannel(c.id)}
          >
            #{c.label}
          </button>
        ))}
      </div>

      <div className={`community-layout${showMembers ? " is-members" : ""}`}>
        <div className="community-feed" ref={feedRef}>
          {posts.length === 0 ? (
            <p className="community-empty">Nothing in #{channel} yet. Start it.</p>
          ) : (
            <div className="community-posts">
              {posts.map((p) => (
                <article key={p.id} className="community-post">
                  <Avatar seed={p.author_handle} />
                  <div>
                    <h2>
                      {p.author_name}{" "}
                      <span className="community-meta">
                        @{p.author_handle} · {timeAgo(p.created_at)}
                      </span>
                    </h2>
                    <p>{p.body}</p>
                    {p.mine && (
                      <button
                        type="button"
                        onClick={async () => {
                          await deletePost({ data: { id: p.id } });
                          await refresh(channel);
                        }}
                      >
                        delete
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="community-composer">
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
              className="community-field"
            />
            <button
              type="button"
              onClick={() => void post()}
              disabled={busy || !body.trim()}
              className="community-cta"
            >
              Send
            </button>
          </div>
          {err && <p className="community-error">{err}</p>}
        </div>

        <aside className="community-roster">
          <h2>Members</h2>
          <ul>
            {members.map((m) => (
              <li key={m.id}>
                <Avatar seed={m.handle} size={28} />
                <div>
                  <strong>{m.display_name}</strong>
                  <span>
                    @{m.handle}
                    {m.city ? ` · ${m.city}` : ""}
                  </span>
                  {m.specialty ? <span>{m.specialty}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </CommunityShell>
  );
}
