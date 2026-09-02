-- 1. Client linkage: trust only verified auth_user_id linkage, not raw email matching.
DROP POLICY IF EXISTS "client reads own record" ON public.clients;
CREATE POLICY "client reads own record" ON public.clients
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "client reads own shoots" ON public.shoots;
CREATE POLICY "client reads own shoots" ON public.shoots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = shoots.client_id AND c.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "client reads own invoices" ON public.invoices;
CREATE POLICY "client reads own invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = invoices.client_id AND c.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "client reads own galleries" ON public.galleries;
CREATE POLICY "client reads own galleries" ON public.galleries
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = galleries.client_id AND c.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "client reads own requests" ON public.booking_requests;
CREATE POLICY "client reads own requests" ON public.booking_requests
  FOR SELECT TO authenticated
  USING (
    lower(requester_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = booking_requests.client_id AND c.auth_user_id = auth.uid())
  );

-- 2. Remove the SECURITY DEFINER functions that were executable by anon/authenticated.
DROP FUNCTION IF EXISTS public.my_client_ids();
DROP FUNCTION IF EXISTS public.claim_client_records();
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3. gallery_photos: the referenced gallery must belong to the caller.
DROP POLICY IF EXISTS "own gallery photos" ON public.gallery_photos;
CREATE POLICY "own gallery photos" ON public.gallery_photos
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.galleries g WHERE g.id = gallery_photos.gallery_id AND g.user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.galleries g WHERE g.id = gallery_photos.gallery_id AND g.user_id = auth.uid())
  );

-- 4. Per-studio authenticated Lightroom bridge credentials.
CREATE TABLE IF NOT EXISTS public.lightroom_workspaces (
  workspace text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.lightroom_workspaces TO authenticated;
GRANT ALL ON public.lightroom_workspaces TO service_role;

ALTER TABLE public.lightroom_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own bridge workspace" ON public.lightroom_workspaces;
CREATE POLICY "own bridge workspace" ON public.lightroom_workspaces
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);