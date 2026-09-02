CREATE TABLE public.booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  requester_email text NOT NULL,
  requester_name text,
  shoot_type text NOT NULL DEFAULT 'portrait',
  preferred_date date,
  location text,
  budget numeric,
  message text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_requests TO authenticated;
GRANT ALL ON public.booking_requests TO service_role;

ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client creates own request"
  ON public.booking_requests FOR INSERT TO authenticated
  WITH CHECK (lower(requester_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

CREATE POLICY "client reads own requests"
  ON public.booking_requests FOR SELECT TO authenticated
  USING (lower(requester_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR client_id IN (SELECT public.my_client_ids()));

CREATE POLICY "photographer manages requests"
  ON public.booking_requests FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_booking_requests_user ON public.booking_requests(user_id);
CREATE INDEX idx_booking_requests_email ON public.booking_requests(lower(requester_email));

CREATE TABLE public.client_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.booking_requests(id) ON DELETE SET NULL,
  uploader_email text NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.client_uploads TO authenticated;
GRANT ALL ON public.client_uploads TO service_role;

ALTER TABLE public.client_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client manages own uploads"
  ON public.client_uploads FOR ALL TO authenticated
  USING (lower(uploader_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  WITH CHECK (lower(uploader_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

CREATE POLICY "photographer reads client uploads"
  ON public.client_uploads FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_client_uploads_client ON public.client_uploads(client_id);
