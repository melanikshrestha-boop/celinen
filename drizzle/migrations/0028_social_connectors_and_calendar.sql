-- Social connectors and the publishing calendar. Additive only: existing Instagram
-- (social_connections), Facebook (facebook_social_connections) and every
-- social_publications row are untouched. Production has migrations through 0027.

-- One row per (owner, provider) for the providers that had no server-side
-- store at all: threads, linkedin, x, tiktok, youtube. Instagram and Facebook
-- keep their existing tables; the server presents all seven through one model.
-- `credential` is an AES-256-GCM sealed JSON {access, refresh} bound to the
-- owner id (SOCIAL_TOKEN_KEY); it never leaves the server.
CREATE TABLE public.social_provider_connections (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('threads', 'linkedin', 'x', 'tiktok', 'youtube')),
  account_id text NOT NULL CHECK (octet_length(account_id) <= 200),
  account_name text NOT NULL CHECK (octet_length(account_name) <= 300),
  -- member | organization | page | channel | user: which kind of thing posts.
  account_kind text NOT NULL DEFAULT 'user' CHECK (octet_length(account_kind) <= 40),
  credential text NOT NULL CHECK (octet_length(credential) <= 20000),
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  -- active: usable. reconnect: the provider refused the token; the owner must connect again.
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'reconnect')),
  state_reason text CHECK (octet_length(state_reason) <= 500),
  -- Two runners refreshing the same single-use refresh token would revoke each other;
  -- the lease lets exactly one refresh while the other waits.
  refresh_lease uuid,
  refresh_lease_until timestamptz,
  token_refreshed_at timestamptz,
  -- Provider facts worth remembering between runs: X tier limits seen in headers,
  -- TikTok creator options, LinkedIn organizations, YouTube quota spent today.
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(meta::text) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);
ALTER TABLE public.social_provider_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_provider_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.social_provider_connections TO service_role;

-- OAuth states gain the provider and a sealed PKCE verifier (X, TikTok, YouTube).
-- Existing Instagram and Facebook rows carry neither and keep working.
ALTER TABLE public.social_oauth_states
  ADD COLUMN IF NOT EXISTS provider text CHECK (octet_length(provider) <= 40),
  ADD COLUMN IF NOT EXISTS verifier text CHECK (octet_length(verifier) <= 1000);

-- The calendar keeps living in social_publications (record->>'kind' = 'schedule').
-- Version 2 records carry per-network units and `nextAttemptAt`, the time the
-- earliest unit wants a runner. The cron tick reads by it; this index is what
-- keeps that read from scanning every publication row.
CREATE INDEX IF NOT EXISTS social_publications_schedule_due
  ON public.social_publications ((record->>'nextAttemptAt'))
  WHERE record->>'kind' = 'schedule'
    AND record->>'status' IN ('scheduled', 'posting', 'uncertain');

-- Video lives beside the JPEG bucket, not in it: publishing-media-v1 is pinned to
-- JPEG/8 MiB by the Instagram publisher's safety check. Private; signed URLs only.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES('publishing-video-v1', 'publishing-video-v1', false, 1073741824, ARRAY['video/mp4', 'video/quicktime'])
ON CONFLICT(id) DO NOTHING;
