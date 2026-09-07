-- Search admission only. No queries, mail, tokens, or photos are stored here.
CREATE TABLE public.workspace_search_usage (
  bucket text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests >= 0)
);
--> statement-breakpoint
CREATE TABLE public.workspace_search_leases (
  id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.workspace_search_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_search_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_search_usage, public.workspace_search_leases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_search_usage, public.workspace_search_leases TO service_role;
--> statement-breakpoint
CREATE FUNCTION public.workspace_take_search(owner_id uuid, lease_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t timestamptz := clock_timestamp(); owner_bucket text := 'owner:' || owner_id::text;
BEGIN
  IF owner_id IS NULL OR lease_id IS NULL THEN RETURN false; END IF;
  -- Serialize admission across app replicas; a browser cannot acquire this lock/RPC.
  PERFORM pg_advisory_xact_lock(624719031);
  DELETE FROM public.workspace_search_leases WHERE expires_at <= t;
  DELETE FROM public.workspace_search_usage WHERE started_at < t - interval '2 days';
  IF (SELECT count(*) FROM public.workspace_search_leases) >= 4 THEN RETURN false; END IF;
  INSERT INTO public.workspace_search_usage AS u (bucket, started_at, requests)
    VALUES (owner_bucket, t, 0), ('global:minute', t, 0), ('global:day', t, 0)
  ON CONFLICT (bucket) DO UPDATE SET
    requests = CASE WHEN u.started_at <= t - CASE WHEN u.bucket = 'global:day' THEN interval '1 day' ELSE interval '1 minute' END THEN 0 ELSE u.requests END,
    started_at = CASE WHEN u.started_at <= t - CASE WHEN u.bucket = 'global:day' THEN interval '1 day' ELSE interval '1 minute' END THEN t ELSE u.started_at END;
  IF EXISTS (SELECT 1 FROM public.workspace_search_usage WHERE
    (bucket = owner_bucket AND requests >= 8) OR
    (bucket = 'global:minute' AND requests >= 60) OR
    (bucket = 'global:day' AND requests >= 1000)) THEN RETURN false; END IF;
  UPDATE public.workspace_search_usage SET requests = requests + 1
    WHERE bucket IN (owner_bucket, 'global:minute', 'global:day');
  -- The provider request times out after 12s. A 45s lease recovers crashed workers.
  INSERT INTO public.workspace_search_leases VALUES (lease_id, t + interval '45 seconds');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.workspace_release_search(lease_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.workspace_search_leases WHERE id = lease_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.workspace_take_search(uuid, uuid), public.workspace_release_search(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_take_search(uuid, uuid), public.workspace_release_search(uuid) TO service_role;
