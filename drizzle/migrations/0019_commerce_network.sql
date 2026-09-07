-- Commerce drafts and opt-in discovery. No existing profiles/photos are made public.
CREATE TABLE public.commerce_shops (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state jsonb NOT NULL CHECK (octet_length(state::text) <= 5000000)
);
CREATE TABLE public.photographer_directory (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile jsonb NOT NULL CHECK (octet_length(profile::text) <= 12000),
  revision bigint NOT NULL DEFAULT 1,
  visible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.photographer_inquiries (
  id uuid PRIMARY KEY,
  sender uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text NOT NULL, recipient_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booking', 'collaboration')),
  message text NOT NULL CHECK (length(message) BETWEEN 20 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender <> recipient)
);
CREATE INDEX photographer_inquiries_received ON public.photographer_inquiries(recipient, created_at DESC);
CREATE INDEX photographer_inquiries_sent ON public.photographer_inquiries(sender, created_at DESC);
-- Reviews will be admitted only by a future verified-booking settlement workflow.
-- No client/server endpoint in this release can create reviews or mark bookings verified.
CREATE TABLE public.photographer_verified_reviews (
  booking_id uuid PRIMARY KEY,
  photographer uuid NOT NULL REFERENCES auth.users(id),
  client_id uuid NOT NULL REFERENCES auth.users(id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  verified_completed_at timestamptz NOT NULL,
  CHECK (photographer <> client_id)
);
CREATE INDEX photographer_review_owner ON public.photographer_verified_reviews(photographer);
ALTER TABLE public.commerce_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photographer_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photographer_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photographer_verified_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commerce_shops, public.photographer_directory, public.photographer_inquiries, public.photographer_verified_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commerce_shops, public.photographer_directory, public.photographer_inquiries, public.photographer_verified_reviews TO service_role;

CREATE FUNCTION public.commerce_save_shop(p_owner uuid, p_state jsonb, p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE prior jsonb; saved jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 19));
  SELECT state INTO prior FROM public.commerce_shops WHERE owner_id = p_owner FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint, 0) <> p_revision THEN RAISE EXCEPTION 'Shop revision conflict'; END IF;
  IF jsonb_typeof(p_state->'products') IS DISTINCT FROM 'array' OR jsonb_array_length(p_state->'products') > 500 THEN RAISE EXCEPTION 'Invalid catalog'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(prior->'products') old WHERE NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(p_state->'products') new WHERE new->>'id' = old->>'id' AND new->>'sourceKey' = old->>'sourceKey')) THEN RAISE EXCEPTION 'Archive products instead of removing them'; END IF;
  saved := p_state || jsonb_build_object('revision', p_revision + 1);
  INSERT INTO public.commerce_shops(owner_id,state) VALUES(p_owner,saved) ON CONFLICT(owner_id) DO UPDATE SET state = saved;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.commerce_save_shop(uuid,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_save_shop(uuid,jsonb,bigint) TO service_role;

CREATE FUNCTION public.directory_save_profile(p_owner uuid, p_profile jsonb, p_revision bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE revision_now bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 20));
  SELECT revision INTO revision_now FROM public.photographer_directory WHERE owner_id = p_owner FOR UPDATE;
  IF coalesce(revision_now, 0) <> p_revision THEN RAISE EXCEPTION 'Profile changed elsewhere'; END IF;
  INSERT INTO public.photographer_directory(owner_id,profile,visible,revision)
  VALUES(p_owner,p_profile,(p_profile->>'visible')::boolean,p_revision+1)
  ON CONFLICT(owner_id) DO UPDATE SET profile=p_profile, visible=(p_profile->>'visible')::boolean, revision=p_revision+1, updated_at=now();
  RETURN p_revision+1;
END $$;
REVOKE ALL ON FUNCTION public.directory_save_profile(uuid,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directory_save_profile(uuid,jsonb,bigint) TO service_role;

CREATE FUNCTION public.directory_send_inquiry(p_sender uuid, p_id uuid, p_recipient uuid, p_name text, p_kind text, p_message text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE target_profile jsonb; prior public.photographer_inquiries;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_sender::text, 21));
  SELECT * INTO prior FROM public.photographer_inquiries WHERE id=p_id;
  IF FOUND THEN
    IF prior.sender=p_sender AND prior.recipient=p_recipient AND prior.kind=p_kind AND prior.message=p_message THEN RETURN prior.id; END IF;
    RAISE EXCEPTION 'Inquiry identity conflict';
  END IF;
  SELECT profile INTO target_profile FROM public.photographer_directory WHERE owner_id=p_recipient AND visible=true AND (profile->>'available')::boolean=true FOR SHARE;
  IF target_profile IS NULL OR p_sender=p_recipient THEN RAISE EXCEPTION 'Photographer unavailable'; END IF;
  IF (SELECT count(*) FROM public.photographer_inquiries WHERE sender=p_sender AND created_at>now()-interval '24 hours') >= 20 THEN RAISE EXCEPTION 'Daily request limit reached'; END IF;
  IF EXISTS(SELECT 1 FROM public.photographer_inquiries WHERE sender=p_sender AND recipient=p_recipient AND status='pending') THEN RAISE EXCEPTION 'A request is already pending'; END IF;
  INSERT INTO public.photographer_inquiries(id,sender,recipient,sender_name,recipient_name,kind,message)
  VALUES(p_id,p_sender,p_recipient,p_name,target_profile->>'displayName',p_kind,p_message);
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.directory_send_inquiry(uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directory_send_inquiry(uuid,uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.directory_discover(p_query text, p_offset integer) RETURNS TABLE(owner uuid, profile jsonb, review_count bigint, rating numeric, score double precision)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH stats AS (
    SELECT photographer, count(*) AS n, avg(rating) AS avg_rating,
      avg(CASE WHEN rating>=4 THEN 1.0 ELSE 0.0 END) AS p
    FROM public.photographer_verified_reviews GROUP BY photographer
  ), ranked AS (
    SELECT d.owner_id AS owner, d.profile, coalesce(s.n,0) AS review_count, s.avg_rating AS rating,
      CASE WHEN s.n>0 THEN ((s.p+3.8416/(2*s.n)-1.96*sqrt((s.p*(1-s.p)+3.8416/(4*s.n))/s.n))/(1+3.8416/s.n))::double precision ELSE 0 END AS score
    FROM public.photographer_directory d LEFT JOIN stats s ON s.photographer=d.owner_id
    WHERE d.visible=true AND strpos(lower(concat_ws(' ', d.profile->>'displayName',d.profile->>'city',d.profile->>'country',d.profile->>'specialties',d.profile->>'languages')),lower(p_query))>0
  ) SELECT * FROM ranked ORDER BY score DESC, review_count DESC, lower(profile->>'displayName'), owner LIMIT 25 OFFSET greatest(0,least(p_offset,10000));
$$;
REVOKE ALL ON FUNCTION public.directory_discover(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directory_discover(text,integer) TO service_role;
