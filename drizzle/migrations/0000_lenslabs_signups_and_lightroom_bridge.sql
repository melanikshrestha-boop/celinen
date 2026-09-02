-- Marketing sign-ups: email + chosen tier (public form, write-only for visitors)
CREATE TABLE public.signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  plan text NOT NULL DEFAULT 'starter',
  billing text NOT NULL DEFAULT 'yearly',
  studio text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX signups_email_plan_key ON public.signups (lower(email), plan);

GRANT INSERT ON public.signups TO anon;
GRANT SELECT, INSERT ON public.signups TO authenticated;
GRANT ALL ON public.signups TO service_role;

ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can sign up" ON public.signups
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Lightroom bridge: durable per-workspace sync channel used by the LR plugin
CREATE TABLE public.lightroom_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('to-studio', 'to-lightroom')),
  kind text NOT NULL DEFAULT 'push',
  frames jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lightroom_sync_channel_key ON public.lightroom_sync (workspace, direction);

GRANT ALL ON public.lightroom_sync TO service_role;

ALTER TABLE public.lightroom_sync ENABLE ROW LEVEL SECURITY;
-- no anon/authenticated policies: reached only through the server bridge route