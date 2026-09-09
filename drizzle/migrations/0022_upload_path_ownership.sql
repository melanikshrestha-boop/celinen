-- Additive security repair. No upload, booking, gallery or original is rewritten.
-- Client references are admitted only by the verified server handlers. An email
-- match is not authority to assign a booking, photographer or private object.
-- The hosted database has broader default grants than the historical files.
-- TRUNCATE is not governed by RLS, so revoke it as well as direct row writes.
REVOKE ALL ON public.client_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_uploads TO authenticated;
REVOKE ALL ON public.gallery_photos FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.gallery_photos, public.booking_requests FROM PUBLIC, authenticated, anon;

-- Guest access tokens live on booking_requests. A raw JWT email is not proof
-- of email ownership. Only inspect the current account, never arbitrary users.
CREATE OR REPLACE FUNCTION public.verified_booking_email(expected text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
      AND u.email IS NOT NULL AND lower(u.email) = lower(expected))
$$;
REVOKE ALL ON FUNCTION public.verified_booking_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verified_booking_email(text) TO authenticated;
DROP POLICY IF EXISTS "client reads own requests" ON public.booking_requests;
CREATE POLICY "client reads own requests" ON public.booking_requests
  FOR SELECT TO authenticated USING (
    public.verified_booking_email(requester_email)
    OR EXISTS (SELECT 1 FROM public.clients c
      WHERE c.id = booking_requests.client_id AND c.auth_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "client manages own uploads" ON public.client_uploads;
DROP POLICY IF EXISTS "client reads verified uploads" ON public.client_uploads;
CREATE POLICY "client reads verified uploads" ON public.client_uploads
  FOR SELECT TO authenticated
  USING (
    (booking_id IS NULL AND split_part(storage_path, '/', 1) = 'client-uploads'
      AND split_part(storage_path, '/', 2) = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public.clients c
      WHERE c.id = client_uploads.client_id AND c.auth_user_id = auth.uid()
        AND c.user_id = client_uploads.user_id)
    OR EXISTS (SELECT 1 FROM public.booking_requests b
      WHERE b.id = client_uploads.booking_id
        AND b.client_id IS NOT DISTINCT FROM client_uploads.client_id
        AND b.user_id IS NOT DISTINCT FROM client_uploads.user_id
        AND lower(b.requester_email) = lower(client_uploads.uploader_email)
        AND public.verified_booking_email(b.requester_email))
  );
-- Restrictive policies remain a backstop if a later grant or permissive policy
-- inadvertently restores direct table writes. service_role is not restricted.
DROP POLICY IF EXISTS "client upload insert requires server" ON public.client_uploads;
CREATE POLICY "client upload insert requires server" ON public.client_uploads
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS "client upload update requires server" ON public.client_uploads;
CREATE POLICY "client upload update requires server" ON public.client_uploads
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "client upload delete requires server" ON public.client_uploads;
CREATE POLICY "client upload delete requires server" ON public.client_uploads
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- Keep the existing owner/read/delete rules and preserve malformed legacy rows.
-- New and changed rows must reference a real, nonempty object in this gallery.
DROP POLICY IF EXISTS "gallery photo verified source" ON public.gallery_photos;
CREATE POLICY "gallery photo verified source" ON public.gallery_photos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.galleries g
      WHERE g.id = gallery_photos.gallery_id AND g.user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.galleries g
      WHERE g.id = gallery_photos.gallery_id AND g.user_id = auth.uid())
    AND storage_path ~ ('\A' || user_id::text || '/' || gallery_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]+\Z')
    AND EXISTS (SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'deliveries' AND o.name = gallery_photos.storage_path
        AND CASE WHEN o.metadata->>'size' ~ '\A[0-9]{1,16}\Z'
          THEN (o.metadata->>'size')::numeric BETWEEN 1 AND 9007199254740991
          ELSE false END)
  );

-- Reserved client-uploads / shoot-refs objects can only be created using a
-- server-issued signed upload. Also prevent renaming a user-owned object into
-- those namespaces, even in the presence of another permissive Storage policy.
DROP POLICY IF EXISTS "delivery upload owner boundary" ON storage.objects;
CREATE POLICY "delivery upload owner boundary" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (bucket_id <> 'deliveries' OR split_part(name, '/', 1) = auth.uid()::text);
DROP POLICY IF EXISTS "delivery update owner boundary" ON storage.objects;
CREATE POLICY "delivery update owner boundary" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (bucket_id <> 'deliveries' OR split_part(name, '/', 1) = auth.uid()::text)
  WITH CHECK (bucket_id <> 'deliveries' OR split_part(name, '/', 1) = auth.uid()::text);
DROP POLICY IF EXISTS "delivery delete owner boundary" ON storage.objects;
CREATE POLICY "delivery delete owner boundary" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (bucket_id <> 'deliveries' OR split_part(name, '/', 1) = auth.uid()::text);
