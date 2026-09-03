-- Anonymous visitors could SELECT every column of a live gallery, including the
-- passcode that gates access. Gallery viewing already goes through the
-- openGallery server function (service-role client, passcode verified server-side),
-- so anon needs no direct read access at all.
DROP POLICY IF EXISTS "public can read live galleries" ON public.galleries;
REVOKE SELECT ON public.galleries FROM anon;