-- Photographer-published shoot packages / rate card
CREATE TABLE public.shoot_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  blurb text,
  price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  unit text NOT NULL DEFAULT 'flat',
  duration text,
  deliverables text,
  turnaround text,
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shoot_packages TO authenticated;
GRANT ALL ON public.shoot_packages TO service_role;

ALTER TABLE public.shoot_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shoot packages" ON public.shoot_packages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A linked client may read their photographer's published packages.
CREATE POLICY "linked clients read published packages" ON public.shoot_packages FOR SELECT TO authenticated
  USING (published AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = shoot_packages.user_id AND c.auth_user_id = auth.uid()
  ));

-- Photographer public profile fields used by the rate card
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS travel_note text,
  ADD COLUMN IF NOT EXISTS booking_note text;

-- Ambassador program applications (sports photographers)
CREATE TABLE public.ambassador_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  school text,
  conference text,
  sports text,
  portfolio text,
  socials text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.ambassador_applications TO anon, authenticated;
GRANT ALL ON public.ambassador_applications TO service_role;

ALTER TABLE public.ambassador_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can apply" ON public.ambassador_applications FOR INSERT TO anon, authenticated
  WITH CHECK (true);
