CREATE TABLE public.galleries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES public.shoots(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  message text,
  cover_path text,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('draft','live','archived')),
  downloads_enabled boolean NOT NULL DEFAULT true,
  passcode text,
  expires_at timestamptz,
  view_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_galleries_user ON public.galleries(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.galleries TO authenticated;
GRANT SELECT ON public.galleries TO anon;
GRANT ALL ON public.galleries TO service_role;
ALTER TABLE public.galleries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own galleries" ON public.galleries FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public can read live galleries" ON public.galleries FOR SELECT TO anon
  USING (status = 'live' AND (expires_at IS NULL OR expires_at > now()));

CREATE TABLE public.gallery_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id uuid NOT NULL REFERENCES public.galleries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename text NOT NULL,
  width int,
  height int,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gallery_photos_gallery ON public.gallery_photos(gallery_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gallery_photos TO authenticated;
GRANT SELECT ON public.gallery_photos TO anon;
GRANT ALL ON public.gallery_photos TO service_role;
ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own gallery photos" ON public.gallery_photos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public can read photos of live galleries" ON public.gallery_photos FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.galleries g
    WHERE g.id = gallery_id AND g.status = 'live'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ));

CREATE TABLE public.gallery_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id uuid NOT NULL REFERENCES public.galleries(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES public.gallery_photos(id) ON DELETE CASCADE,
  viewer text NOT NULL DEFAULT 'client',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (photo_id, viewer)
);
CREATE INDEX idx_gallery_favorites_gallery ON public.gallery_favorites(gallery_id);
GRANT SELECT, INSERT, DELETE ON public.gallery_favorites TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gallery_favorites TO authenticated;
GRANT ALL ON public.gallery_favorites TO service_role;
ALTER TABLE public.gallery_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photographer reads favorites" ON public.gallery_favorites FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.galleries g WHERE g.id = gallery_id AND g.user_id = auth.uid()));
CREATE POLICY "client can favorite in a live gallery" ON public.gallery_favorites FOR INSERT TO anon
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.galleries g
    WHERE g.id = gallery_id AND g.status = 'live'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ));
CREATE POLICY "client can read favorites in a live gallery" ON public.gallery_favorites FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.galleries g
    WHERE g.id = gallery_id AND g.status = 'live'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ));
CREATE POLICY "client can unfavorite in a live gallery" ON public.gallery_favorites FOR DELETE TO anon
  USING (EXISTS (
    SELECT 1 FROM public.galleries g
    WHERE g.id = gallery_id AND g.status = 'live'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ));