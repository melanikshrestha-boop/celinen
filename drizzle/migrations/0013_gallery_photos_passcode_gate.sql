-- Anonymous API reads of gallery photos bypassed the passcode gate entirely.
-- All public gallery access goes through the server (openGallery), which
-- validates the passcode and uses the service role, so anon needs no direct read.
DROP POLICY IF EXISTS "public can read photos of live galleries" ON public.gallery_photos;
REVOKE SELECT ON public.gallery_photos FROM anon;