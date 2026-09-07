-- Server-only business records. Every server operation binds the verified account id.
CREATE TABLE public.business_clients (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state jsonb NOT NULL CHECK (octet_length(state::text) <= 5000000)
);
ALTER TABLE public.business_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_clients FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.business_clients TO service_role;

CREATE FUNCTION public.business_save_clients(p_owner uuid, p_state jsonb, p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE prior jsonb; saved jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 18));
  SELECT state INTO prior FROM public.business_clients WHERE owner_id = p_owner FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint, 0) <> p_revision THEN RAISE EXCEPTION 'Client revision conflict'; END IF;
  IF jsonb_typeof(p_state->'clients') IS DISTINCT FROM 'array' OR jsonb_array_length(p_state->'clients') > 10000 THEN RAISE EXCEPTION 'Invalid clients'; END IF;
  -- Archiving is supported, silent deletion of records is not.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(prior->'clients') old WHERE NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(p_state->'clients') new WHERE new->>'id' = old->>'id')) THEN RAISE EXCEPTION 'Client deletion not allowed'; END IF;
  saved := p_state || jsonb_build_object('revision', p_revision + 1, 'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO public.business_clients(owner_id, state) VALUES(p_owner, saved) ON CONFLICT(owner_id) DO UPDATE SET state = saved;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.business_save_clients(uuid,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_save_clients(uuid,jsonb,bigint) TO service_role;

CREATE TABLE public.social_connections (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id text NOT NULL, username text NOT NULL,
  credential text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE public.social_oauth_states (
  hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE public.social_publications (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record jsonb NOT NULL CHECK (octet_length(record::text) <= 100000),
  revision bigint NOT NULL DEFAULT 0,
  lease uuid, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_publications_owner ON public.social_publications(owner_id, created_at DESC);
CREATE INDEX social_oauth_owner ON public.social_oauth_states(owner_id);
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_connections, public.social_oauth_states, public.social_publications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.social_connections, public.social_oauth_states, public.social_publications TO service_role;

-- Private copies: only explicit publication can expose a signed image URL.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES('publishing-media-v1', 'publishing-media-v1', false, 8388608, ARRAY['image/jpeg'])
ON CONFLICT(id) DO NOTHING;
