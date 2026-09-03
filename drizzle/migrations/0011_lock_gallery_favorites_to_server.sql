-- Favourites are now only writable through the server, which requires a signed per-visitor token.
DROP POLICY IF EXISTS "client can favorite in a live gallery" ON public.gallery_favorites;
DROP POLICY IF EXISTS "client can unfavorite in a live gallery" ON public.gallery_favorites;
DROP POLICY IF EXISTS "client can read favorites in a live gallery" ON public.gallery_favorites;

REVOKE ALL ON public.gallery_favorites FROM anon;
GRANT SELECT ON public.gallery_favorites TO authenticated;
GRANT ALL ON public.gallery_favorites TO service_role;
