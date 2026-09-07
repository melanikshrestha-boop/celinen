-- Additive: legacy galleries and locally saved shoots are not migrated or removed.
CREATE TABLE public.delivery_rooms (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  invitation_hash text,
  state jsonb NOT NULL CHECK (state->>'format' = '1' AND octet_length(state::text) <= 16777216),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX delivery_rooms_owner_updated ON public.delivery_rooms(owner_id, updated_at DESC);
--> statement-breakpoint
ALTER TABLE public.delivery_rooms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.delivery_rooms FROM anon, authenticated;
--> statement-breakpoint
GRANT ALL ON public.delivery_rooms TO service_role;
--> statement-breakpoint
-- No client storage policies. Only server-reserved immutable signed uploads are accepted.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('delivery-private-v1', 'delivery-private-v1', false, 31457280, ARRAY['image/jpeg']);
--> statement-breakpoint
CREATE TABLE public.delivery_rate_limits (
  key text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
ALTER TABLE public.delivery_rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.delivery_rate_limits FROM anon, authenticated;
--> statement-breakpoint
GRANT ALL ON public.delivery_rate_limits TO service_role;
--> statement-breakpoint
CREATE FUNCTION public.delivery_take_request(rate_key text, max_requests integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.delivery_rate_limits AS r (key) VALUES (rate_key)
  ON CONFLICT (key) DO UPDATE SET
    requests = CASE WHEN r.started_at < now() - interval '1 minute' THEN 1 ELSE r.requests + 1 END,
    started_at = CASE WHEN r.started_at < now() - interval '1 minute' THEN now() ELSE r.started_at END
  RETURNING requests INTO n;
  RETURN n <= LEAST(max_requests, 300);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delivery_take_request(text, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delivery_take_request(text, integer) TO service_role;
