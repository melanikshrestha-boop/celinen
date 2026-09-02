-- ============ client vibe sessions (consent-based) ============
CREATE TABLE public.vibe_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.booking_requests(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  user_id uuid,
  owner_auth_id uuid NOT NULL,
  consent boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  vibe_tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vibe_sessions TO authenticated;
GRANT ALL ON public.vibe_sessions TO service_role;

ALTER TABLE public.vibe_sessions ENABLE ROW LEVEL SECURITY;

-- the client who owns the session
CREATE POLICY "Client owns their vibe session"
  ON public.vibe_sessions FOR ALL TO authenticated
  USING (owner_auth_id = auth.uid())
  WITH CHECK (owner_auth_id = auth.uid());

-- the photographer whose studio the session belongs to can read it
CREATE POLICY "Photographer reads vibe sessions for their studio"
  ON public.vibe_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX vibe_sessions_owner_idx ON public.vibe_sessions (owner_auth_id);
CREATE INDEX vibe_sessions_studio_idx ON public.vibe_sessions (user_id);

-- ============ photographer community ============
CREATE TABLE public.community_profiles (
  id uuid PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text,
  city text,
  specialty text,
  website text,
  avatar_seed text NOT NULL DEFAULT 'iris',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.community_profiles TO authenticated;
GRANT ALL ON public.community_profiles TO service_role;

ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read all profiles"
  ON public.community_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Members create their own profile"
  ON public.community_profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Members update their own profile"
  ON public.community_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'general',
  parent_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.community_posts TO authenticated;
GRANT ALL ON public.community_posts TO service_role;

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read the feed"
  ON public.community_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Members post as themselves"
  ON public.community_posts FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "Members delete their own posts"
  ON public.community_posts FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE INDEX community_posts_channel_idx ON public.community_posts (channel, created_at DESC);
CREATE INDEX community_posts_parent_idx ON public.community_posts (parent_id);