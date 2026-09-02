ALTER TABLE public.booking_requests
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS gallery_id uuid REFERENCES public.galleries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_access_token_key
  ON public.booking_requests (access_token)
  WHERE access_token IS NOT NULL;